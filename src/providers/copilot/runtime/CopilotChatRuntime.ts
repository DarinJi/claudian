import { promises as fs } from 'fs';
import os from 'os';
import path from 'path';
import type { Readable } from 'stream';

import type { McpServerManager } from '../../../core/mcp/McpServerManager';
import { ProviderSettingsCoordinator } from '../../../core/providers/ProviderSettingsCoordinator';
import type { ProviderCapabilities, ProviderId } from '../../../core/providers/types';
import type { ChatRuntime } from '../../../core/runtime/ChatRuntime';
import type {
  ApprovalDecisionOption,
  ApprovalCallback,
  AskUserQuestionCallback,
  AutoTurnResult,
  ChatRewindResult,
  ChatRuntimeConversationState,
  ChatRuntimeEnsureReadyOptions,
  ChatRuntimeQueryOptions,
  ChatTurnMetadata,
  ChatTurnRequest,
  ExitPlanModeCallback,
  PreparedChatTurn,
  SessionUpdateResult,
  SubagentRuntimeState,
} from '../../../core/runtime/types';
import type {
  ApprovalDecision,
  ChatMessage,
  Conversation,
  ConversationMeta,
  McpServerConfig,
  SlashCommand,
  StreamChunk,
  ToolCallInfo,
} from '../../../core/types';
import type ClaudianPlugin from '../../../main';
import { maybeGetCopilotWorkspaceServices } from '../app/CopilotWorkspaceServices';
import { COPILOT_PROVIDER_CAPABILITIES } from '../capabilities';
import { encodeCopilotTurn } from '../prompt/CopilotTurnEncoder';
import { getCopilotProviderSettings } from '../settings';
import { type CopilotProviderState,getCopilotState } from '../types';
import {
  DEFAULT_COPILOT_MODEL,
  isSupportedCopilotModel,
  resolveActualCopilotModel,
} from '../ui/CopilotChatUIConfig';
import { normalizeCopilotAcpSessionUpdate } from './CopilotAcpSessionUpdateNormalizer';
import {
  initializeCopilotAcpTransport,
  resolveCopilotAcpLaunchSpec,
  resolveCopilotPromptLaunchSpec,
} from './copilotAcpSupport';
import { buildCopilotAcpPromptContent } from './CopilotUserMessageFactory';
import type { CopilotAcpInitializeResult } from './copilotAcpTypes';
import type {
  CopilotAcpListSessionsResponse,
  CopilotAcpLoadSessionResponse,
  CopilotAcpNewSessionRequest,
  CopilotAcpPermissionOption,
  CopilotAcpPermissionRequest,
  CopilotAcpPermissionResponse,
  CopilotAcpPromptRequest,
  CopilotAcpNewSessionResponse,
  CopilotAcpPromptResponse,
  CopilotAcpSessionConfigOption,
  CopilotAcpSessionReferenceRequest,
  CopilotAcpSetConfigOptionResponse,
  CopilotAcpSetModeResponse,
} from './copilotAcpTypes';
import { CopilotCliProcess } from './CopilotCliProcess';
import type { CopilotLaunchSpec } from './copilotLaunchTypes';
import { CopilotRpcTransport } from './CopilotRpcTransport';

export function resolveCopilotRuntimeModel(
  candidateModel?: string,
  providerModel?: string,
): string {
  if (candidateModel && isSupportedCopilotModel(candidateModel)) {
    return resolveActualCopilotModel(candidateModel);
  }

  const normalizedModel = providerModel && isSupportedCopilotModel(providerModel)
    ? providerModel
    : DEFAULT_COPILOT_MODEL;

  return resolveActualCopilotModel(normalizedModel);
}

export function resolveCopilotPermissionMode(modeId: string): 'yolo' | 'plan' | 'normal' | null {
  const normalized = modeId.trim().toLowerCase();
  if (!normalized) {
    return null;
  }

  if (normalized === 'plan' || normalized.endsWith('#plan') || normalized.includes('/plan')) {
    return 'plan';
  }

  if (
    normalized === 'autopilot'
    || normalized.endsWith('#autopilot')
    || normalized.includes('autopilot')
    || normalized.includes('bypasspermissions')
    || normalized.includes('yolo')
  ) {
    return 'yolo';
  }

  if (
    normalized === 'agent'
    || normalized.endsWith('#agent')
    || normalized.includes('agent')
    || normalized.includes('safe')
    || normalized.includes('normal')
  ) {
    return 'normal';
  }

  return null;
}

export function resolveCopilotSdkPermissionMode(modeId: string): string | null {
  const permissionMode = resolveCopilotPermissionMode(modeId);
  if (permissionMode === 'yolo') {
    return 'bypassPermissions';
  }
  if (permissionMode === 'plan') {
    return 'plan';
  }
  if (permissionMode === 'normal') {
    return 'default';
  }
  return null;
}

export function resolveCopilotSessionModeId(permissionMode: string): string | null {
  if (permissionMode === 'plan') {
    return 'https://agentclientprotocol.com/protocol/session-modes#plan';
  }
  if (permissionMode === 'yolo') {
    return 'https://agentclientprotocol.com/protocol/session-modes#autopilot';
  }
  if (permissionMode === 'normal') {
    return 'https://agentclientprotocol.com/protocol/session-modes#agent';
  }
  return null;
}

export function resolveDesiredCopilotSessionModeId(
  requestedPermissionMode: string | null | undefined,
  persistedDesiredModeId: string | null,
): string | null {
  const requestedModeId = requestedPermissionMode
    ? resolveCopilotSessionModeId(requestedPermissionMode)
    : null;

  return requestedModeId ?? persistedDesiredModeId;
}

function buildRuntimeCommand(command: Partial<SlashCommand> & { name?: unknown }, index: number): SlashCommand | null {
  const rawName = typeof command.name === 'string' ? command.name.trim() : '';
  if (!rawName) {
    return null;
  }

  return {
    id: typeof command.id === 'string' && command.id.trim()
      ? command.id
      : `copilot:sdk:${rawName}:${index}`,
    name: rawName,
    description: typeof command.description === 'string' ? command.description : undefined,
    argumentHint: typeof command.argumentHint === 'string' ? command.argumentHint : undefined,
    content: typeof command.content === 'string' ? command.content : '',
    source: 'sdk',
    kind: command.kind === 'skill' ? 'skill' : 'command',
    allowedTools: Array.isArray(command.allowedTools)
      ? command.allowedTools.filter((value): value is string => typeof value === 'string')
      : undefined,
    model: typeof command.model === 'string' ? command.model : undefined,
    disableModelInvocation: command.disableModelInvocation === true ? true : undefined,
    userInvocable: typeof command.userInvocable === 'boolean' ? command.userInvocable : undefined,
  };
}

export function extractCopilotSupportedCommands(payload: unknown): SlashCommand[] {
  if (!payload || typeof payload !== 'object') {
    return [];
  }

  const source = payload as Record<string, unknown>;
  const candidates = [
    source.commands,
    source.availableCommands,
    source.available_commands,
    source.slashCommands,
    source.slash_commands,
  ];

  const rawCommands = candidates.find(Array.isArray);
  if (!rawCommands) {
    return [];
  }

  return rawCommands.flatMap((entry, index) => {
    if (typeof entry === 'string') {
      return [{
        id: `copilot:sdk:${entry}:${index}`,
        name: entry,
        content: '',
        source: 'sdk' as const,
      } satisfies SlashCommand];
    }

    if (!entry || typeof entry !== 'object') {
      return [];
    }

    const command = buildRuntimeCommand(entry as Partial<SlashCommand> & { name?: unknown }, index);
    return command ? [command] : [];
  });
}

export function resolveDesiredCopilotSessionModel(
  selectedModel: string,
  persistedDesiredModelId: string | null,
): string {
  return selectedModel || persistedDesiredModelId || resolveActualCopilotModel(DEFAULT_COPILOT_MODEL);
}

export function resolveCopilotActiveMcpServers(
  mcpManager: Pick<McpServerManager, 'extractMentions' | 'getActiveServers'> | null,
  promptText: string,
  enabledMcpServers?: ReadonlySet<string> | null,
): Record<string, McpServerConfig> {
  if (!mcpManager) {
    return {};
  }

  const mentions = mcpManager.extractMentions(promptText);
  const activeServerNames = new Set<string>(mentions);
  for (const serverName of enabledMcpServers ?? []) {
    activeServerNames.add(serverName);
  }

  return mcpManager.getActiveServers(activeServerNames);
}

export function resolveCopilotAcpSessionMcpServers(
  mcpServers: Record<string, McpServerConfig> | null | undefined,
): string[] {
  if (!mcpServers) {
    return [];
  }

  return Object.keys(mcpServers);
}

export function augmentCopilotPromptForImageAttachments(
  prompt: string,
  rawUserText: string,
  hasImages: boolean,
): string {
  if (!hasImages || rawUserText.trim()) {
    return prompt;
  }

  const imageOnlyInstruction = [
    'The user attached one or more images.',
    'Carefully inspect the attached image content and respond based on what you see.',
    'If there is no additional user text, briefly describe the image and offer a focused next step.',
  ].join(' ');

  if (!prompt.trim()) {
    return imageOnlyInstruction;
  }

  return `${imageOnlyInstruction}\n\n${prompt}`;
}

export function resolveCopilotPermissionOutcomeOptionId(
  decision: ApprovalDecision | null | undefined,
  options?: CopilotAcpPermissionOption[],
): string {
  const allowOnce = options?.find((option) => option.optionId === 'allow_once')?.optionId ?? 'allow_once';
  const allowAlways = options?.find((option) => option.optionId === 'allow_always')?.optionId ?? allowOnce;
  const rejectOnce = options?.find((option) => option.optionId === 'reject_once')?.optionId ?? 'reject_once';

  if (decision === 'allow') {
    return allowOnce;
  }

  if (decision === 'allow-always') {
    return allowAlways;
  }

  if (decision && typeof decision === 'object' && decision.type === 'select-option') {
    return options?.some((option) => option.optionId === decision.value)
      ? decision.value
      : rejectOnce;
  }

  return rejectOnce;
}

function buildCopilotPermissionDecisionOptions(
  options?: CopilotAcpPermissionOption[],
): ApprovalDecisionOption[] | undefined {
  if (!options || options.length === 0) {
    return undefined;
  }

  return options.map((option) => ({
    label: option.name ?? option.optionId,
    description: option.kind ? `Copilot permission option: ${option.kind}` : undefined,
    value: option.optionId,
    decision: option.optionId === 'allow_once'
      ? 'allow'
      : option.optionId === 'allow_always'
        ? 'allow-always'
        : option.optionId === 'reject_once'
          ? 'deny'
          : undefined,
  }));
}

function sanitizeCopilotSessionImageBaseName(fileName: string): string {
  const trimmed = fileName.trim();
  const normalized = trimmed || 'attachment';
  return normalized.replace(/[^a-zA-Z0-9._-]+/g, '-');
}

function extensionForCopilotImage(mediaType: string): string {
  if (mediaType === 'image/jpeg') return '.jpg';
  if (mediaType === 'image/gif') return '.gif';
  if (mediaType === 'image/webp') return '.webp';
  return '.png';
}

export function buildCopilotSessionImageMirrorPlan(
  sessionId: string,
  images: readonly ChatTurnRequest['images'][number][],
  homeDir: string,
): Array<{ filePath: string; data: Buffer }> {
  const filesDir = path.join(homeDir, '.copilot', 'session-state', sessionId, 'files');

  return images.map((image, index) => {
    const safeBaseName = sanitizeCopilotSessionImageBaseName(image.name.replace(/\.[^.]+$/, ''));
    const extension = extensionForCopilotImage(image.mediaType);
    const filePath = path.join(filesDir, `${index + 1}-${safeBaseName}${extension}`);
    const rawData = image.data.startsWith('data:')
      ? image.data.slice(image.data.indexOf(',') + 1)
      : image.data;

    return {
      filePath,
      data: Buffer.from(rawData, 'base64'),
    };
  });
}

export class CopilotChatRuntime implements ChatRuntime {
  readonly providerId: ProviderId = 'copilot';

  private plugin: ClaudianPlugin;
  private mcpManager: McpServerManager | null;
  private acpProcess: CopilotCliProcess | null = null;
  private acpTransport: CopilotRpcTransport | null = null;
  private acpInitializeResult: CopilotAcpInitializeResult | null = null;
  private acpConfigKey: string | null = null;
  private acpWarning: string | null = null;
  private acpSessionId: string | null = null;
  private desiredSessionId: string | null = null;
  private activeAcpSessionId: string | null = null;
  private activeAcpChunkSink: ((chunk: StreamChunk) => void) | null = null;
  private activePromptProcess: CopilotCliProcess | null = null;
  private ready = false;
  private readyListeners = new Set<(ready: boolean) => void>();
  private turnMetadata: ChatTurnMetadata = {};
  private supportedCommands: SlashCommand[] = [];
  private sessionInvalidated = false;
  private approvalCallback: ApprovalCallback | null = null;
  private approvalDismisser: (() => void) | null = null;
  private askUserCallback: AskUserQuestionCallback | null = null;
  private exitPlanModeCallback: ExitPlanModeCallback | null = null;
  private permissionModeSyncCallback: ((sdkMode: string) => void) | null = null;
  private subagentHookProvider: (() => SubagentRuntimeState) | null = null;
  private autoTurnCallback: ((result: AutoTurnResult) => void) | null = null;
  private resumeCheckpoint: string | undefined;
  private canceled = false;
  private currentExternalContextPaths: string[] = [];
  private currentActiveMcpServers: Record<string, McpServerConfig> = {};
  private currentModeId: string | null = null;
  private currentModelId: string | null = null;
  private currentConfigValues: Record<string, string> = {};

  constructor(plugin: ClaudianPlugin) {
    this.plugin = plugin;
    this.mcpManager = maybeGetCopilotWorkspaceServices()?.mcpServerManager ?? null;
  }

  getCapabilities(): Readonly<ProviderCapabilities> {
    return COPILOT_PROVIDER_CAPABILITIES;
  }

  prepareTurn(request: ChatTurnRequest): PreparedChatTurn {
    return encodeCopilotTurn(request);
  }

  onReadyStateChange(listener: (ready: boolean) => void): () => void {
    this.readyListeners.add(listener);
    try {
      listener(this.ready);
    } catch {
      // Ignore listener errors.
    }

    return () => {
      this.readyListeners.delete(listener);
    };
  }

  setResumeCheckpoint(checkpointId: string | undefined): void {
    this.resumeCheckpoint = checkpointId;
  }

  syncConversationState(
    conversation: ChatRuntimeConversationState | null,
    externalContextPaths?: string[],
  ): void {
    if (!conversation) {
      this.desiredSessionId = null;
      this.acpSessionId = null;
      this.currentExternalContextPaths = [];
      this.currentActiveMcpServers = {};
      this.currentModeId = null;
      this.currentModelId = null;
      this.currentConfigValues = {};
      this.supportedCommands = [];
      return;
    }

    const state = getCopilotState(conversation.providerState);

    if (state.forkSource && !conversation.sessionId) {
      this.desiredSessionId = null;
      this.acpSessionId = null;
    } else {
      this.desiredSessionId = conversation.sessionId ?? null;
      this.acpSessionId = conversation.sessionId ?? null;
    }

    this.currentExternalContextPaths = [...(externalContextPaths ?? [])];
    this.currentModeId = state.currentModeId ?? null;
    this.currentModelId = state.currentModelId ?? null;
    this.currentConfigValues = { ...(state.configValues ?? {}) };
  }

  async reloadMcpServers(): Promise<void> {
    await this.mcpManager?.loadServers();
    await this.shutdownAcpProcess();
  }

  async ensureReady(options?: ChatRuntimeEnsureReadyOptions): Promise<boolean> {
    const cliPath = this.plugin.getResolvedProviderCliPath(this.providerId);
    const providerSettings = this.getProviderSettings();
    const copilotSettings = getCopilotProviderSettings(providerSettings);
    const hasCli = Boolean(cliPath && cliPath.trim().length > 0);
    const externalContextPaths = options?.externalContextPaths ?? this.currentExternalContextPaths;

    this.acpWarning = null;

    if (hasCli && copilotSettings.useACP) {
      try {
        const defaultModel = this.resolveModel();
        await this.ensureAcpProcess(defaultModel, externalContextPaths);
      } catch (error) {
        this.acpWarning = error instanceof Error ? error.message : String(error);
        await this.shutdownAcpProcess();
      }
    } else {
      await this.shutdownAcpProcess();
    }

    this.setReady(hasCli);
    return this.ready;
  }

  async *query(
    turn: PreparedChatTurn,
    conversationHistory?: ChatMessage[],
    queryOptions?: ChatRuntimeQueryOptions,
  ): AsyncGenerator<StreamChunk> {
    this.canceled = false;
    this.turnMetadata = { wasSent: true };

    const providerSettings = this.getProviderSettings();
    const selectedModel = this.resolveModel(queryOptions);
    const prompt = augmentCopilotPromptForImageAttachments(
      turn.prompt.trim(),
      turn.request.text,
      (turn.request.images?.length ?? 0) > 0,
    );
    const images = turn.request.images;
    const hasImages = (images?.length ?? 0) > 0;
    const history = conversationHistory ?? [];
    const externalContextPaths = [
      ...(turn.request.externalContextPaths ?? []),
      ...(queryOptions?.externalContextPaths ?? []),
    ];
    this.currentActiveMcpServers = resolveCopilotActiveMcpServers(
      this.mcpManager,
      turn.request.text,
      turn.request.enabledMcpServers ?? queryOptions?.enabledMcpServers,
    );
    const ready = await this.ensureReady({ externalContextPaths });

    yield { type: 'assistant_message_start' };

    if (!ready) {
      yield { type: 'error', content: 'Copilot provider is not ready. Configure the Copilot CLI path in settings before using this provider.' };
      yield { type: 'done' };
      return;
    }

    if (!prompt && !hasImages) {
      yield { type: 'notice', content: 'Copilot received an empty prompt.', level: 'warning' };
      yield { type: 'done' };
      return;
    }

    if (this.acpWarning) {
      yield {
        type: 'notice',
        level: 'warning',
        content: `ACP preflight failed, using prompt fallback instead: ${this.acpWarning}`,
      };
    }

    const canUseAcpImages = !hasImages || this.acpInitializeResult?.agentCapabilities?.promptCapabilities?.image === true;
    if (hasImages && (!getCopilotProviderSettings(providerSettings).useACP || this.acpWarning || !canUseAcpImages)) {
      yield {
        type: 'error',
        content: 'Copilot image attachments require ACP prompt support, but ACP is not available for this turn.',
      };
      yield { type: 'done' };
      return;
    }

    if (this.canceled) {
      yield { type: 'done' };
      return;
    }

    if (getCopilotProviderSettings(providerSettings).useACP
      && !this.acpWarning) {
      try {
        for await (const chunk of this.runAcpTurn(selectedModel, prompt, history, images)) {
          yield chunk;
        }
        yield { type: 'done' };
        return;
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        if (hasImages) {
          yield {
            type: 'error',
            content: `ACP turn failed and prompt fallback cannot send image attachments: ${message}`,
          };
          yield { type: 'done' };
          return;
        }
        yield {
          type: 'notice',
          level: 'warning',
          content: `ACP turn failed, falling back to prompt mode: ${message}`,
        };
      }
    }

    const launchSpec = resolveCopilotPromptLaunchSpec(this.plugin, {
      prompt: this.buildPromptWithConversationHistory(prompt, history, !this.desiredSessionId && history.length > 0),
      model: selectedModel,
      allowedTools: queryOptions?.allowedTools,
      externalContextPaths,
      mcpServers: this.currentActiveMcpServers,
    });

    for await (const chunk of this.runPromptProcess(launchSpec)) {
      yield chunk;
    }

    yield { type: 'done' };
  }

  private getProviderSettings(): Record<string, unknown> {
    return ProviderSettingsCoordinator.getProviderSettingsSnapshot(
      this.plugin.settings as unknown as Record<string, unknown>,
      this.providerId,
    );
  }

  private resolveModel(queryOptions?: ChatRuntimeQueryOptions): string {
    const providerSettings = this.getProviderSettings();
    const providerModel = typeof providerSettings.model === 'string'
      ? providerSettings.model
      : DEFAULT_COPILOT_MODEL;

    return resolveCopilotRuntimeModel(queryOptions?.model, providerModel);
  }

  cancel(): void {
    this.canceled = true;
    this.sessionInvalidated = false;
    this.turnMetadata = {};
    if (this.activeAcpSessionId && this.acpTransport) {
      this.acpTransport.notify('session/cancel', {
        sessionId: this.activeAcpSessionId,
      });
    }
    if (this.activePromptProcess) {
      void this.activePromptProcess.shutdown().catch(() => {});
    }
  }

  getCurrentModelId(): string | null {
    return this.currentConfigValues.model ?? this.currentModelId ?? null;
  }

  resetSession(): void {
    this.acpSessionId = null;
    this.desiredSessionId = null;
    this.resumeCheckpoint = undefined;
    this.sessionInvalidated = false;
    this.currentExternalContextPaths = [];
    this.currentActiveMcpServers = {};
    this.currentModeId = null;
    this.currentModelId = null;
    this.currentConfigValues = {};
    this.supportedCommands = [];
  }

  getSessionId(): string | null {
    return this.acpSessionId;
  }

  consumeSessionInvalidation(): boolean {
    const invalidated = this.sessionInvalidated;
    this.sessionInvalidated = false;
    return invalidated;
  }

  isReady(): boolean {
    return this.ready;
  }

  async getSupportedCommands(): Promise<SlashCommand[]> {
    if (!getCopilotProviderSettings(this.getProviderSettings()).useACP) {
      return [];
    }

    await this.ensureReady({ externalContextPaths: this.currentExternalContextPaths });
    return [...this.supportedCommands];
  }

  async listResumeConversations(): Promise<ConversationMeta[]> {
    await this.ensureReady();
    if (!getCopilotProviderSettings(this.plugin.settings as unknown as Record<string, unknown>).useACP) {
      return [];
    }

    const transport = this.acpTransport;
    if (!transport) {
      return [];
    }

    const result = await transport.request<CopilotAcpListSessionsResponse>('session/list', {}, 0);
    const currentVaultPath = this.getVaultPath();

    return (result.sessions ?? [])
      .filter((session) => !currentVaultPath || !session.cwd || session.cwd === currentVaultPath)
      .map((session) => {
        const timestamp = session.updatedAt ? Date.parse(session.updatedAt) : Date.now();
        const title = session.title?.trim() || 'Copilot session';
        return {
          id: session.sessionId,
          providerId: 'copilot' as const,
          title,
          createdAt: Number.isFinite(timestamp) ? timestamp : Date.now(),
          updatedAt: Number.isFinite(timestamp) ? timestamp : Date.now(),
          lastResponseAt: Number.isFinite(timestamp) ? timestamp : undefined,
          messageCount: 0,
          preview: title,
        } satisfies ConversationMeta;
      });
  }

  cleanup(): void {
    this.cancel();
    void this.shutdownAcpProcess().catch(() => {});
    this.setReady(false);
    this.turnMetadata = {};
    this.resumeCheckpoint = undefined;
  }

  async rewind(_userMessageId: string, _assistantMessageId: string): Promise<ChatRewindResult> {
    return {
      canRewind: false,
      error: 'Rewind is not supported by the Copilot provider scaffold.',
    };
  }

  setApprovalCallback(callback: ApprovalCallback | null): void {
    this.approvalCallback = callback;
  }

  setApprovalDismisser(dismisser: (() => void) | null): void {
    this.approvalDismisser = dismisser;
  }

  setAskUserQuestionCallback(callback: AskUserQuestionCallback | null): void {
    this.askUserCallback = callback;
  }

  setExitPlanModeCallback(callback: ExitPlanModeCallback | null): void {
    this.exitPlanModeCallback = callback;
  }

  setPermissionModeSyncCallback(callback: ((sdkMode: string) => void) | null): void {
    this.permissionModeSyncCallback = callback;
  }

  setSubagentHookProvider(getState: () => SubagentRuntimeState): void {
    this.subagentHookProvider = getState;
  }

  setAutoTurnCallback(callback: ((result: AutoTurnResult) => void) | null): void {
    this.autoTurnCallback = callback;
  }
  consumeTurnMetadata(): ChatTurnMetadata {
    const metadata = { ...this.turnMetadata };
    this.turnMetadata = {};
    return metadata;
  }

  buildSessionUpdates(params: {
    conversation: Conversation | null;
    sessionInvalidated: boolean;
  }): SessionUpdateResult {
    if (params.sessionInvalidated) {
      return {
        updates: {
          sessionId: null,
          providerState: undefined,
        },
      };
    }

    const existingState = getCopilotState(params.conversation?.providerState);
    const providerState: CopilotProviderState = {
      ...existingState,
      ...(this.currentModeId ? { currentModeId: this.currentModeId } : {}),
      ...(this.currentModelId ? { currentModelId: this.currentModelId } : {}),
      ...(Object.keys(this.currentConfigValues).length > 0 ? { configValues: this.currentConfigValues } : {}),
    };

    if (existingState.forkSource && this.acpSessionId && this.acpSessionId !== existingState.forkSource.sessionId) {
      delete providerState.forkSource;
    }

    return {
      updates: {
        sessionId: this.acpSessionId ?? params.conversation?.sessionId ?? null,
        providerState: Object.keys(providerState).length > 0
          ? providerState as Record<string, unknown>
          : undefined,
      },
    };
  }

  resolveSessionIdForFork(conversation: Conversation | null): string | null {
    if (this.acpSessionId) {
      return this.acpSessionId;
    }
    if (!conversation) {
      return null;
    }
    const state = getCopilotState(conversation.providerState);
    return conversation.sessionId ?? state.forkSource?.sessionId ?? null;
  }

  async loadSubagentToolCalls(_agentId: string): Promise<ToolCallInfo[]> {
    return [];
  }

  async loadSubagentFinalResult(_agentId: string): Promise<string | null> {
    return null;
  }

  private async ensureAcpProcess(selectedModel: string, externalContextPaths?: string[]): Promise<void> {
    const launchSpec = resolveCopilotAcpLaunchSpec(
      this.plugin,
      selectedModel,
      externalContextPaths,
      this.currentActiveMcpServers,
    );
    const configKey = JSON.stringify({
      command: launchSpec.command,
      args: launchSpec.args,
      spawnCwd: launchSpec.spawnCwd,
      envText: this.plugin.getActiveEnvironmentVariables(this.providerId),
    });

    const shouldRebuild = !this.acpProcess
      || !this.acpTransport
      || !this.acpProcess.isAlive()
      || this.acpConfigKey !== configKey;

    if (!shouldRebuild) {
      return;
    }

    await this.shutdownAcpProcess();

    const process = new CopilotCliProcess(launchSpec);
    process.start();

    const transport = new CopilotRpcTransport(process);
    transport.start();
    transport.onNotification('session/update', (params) => {
      this.handleAcpSessionUpdate(params);
    });
    transport.onServerRequest('session/request_permission', async (_requestId, params) => {
      return this.handleAcpPermissionRequest(params as CopilotAcpPermissionRequest);
    });

    this.acpInitializeResult = await initializeCopilotAcpTransport(transport);
    this.acpProcess = process;
    this.acpTransport = transport;
    this.acpConfigKey = configKey;
  }

  private async shutdownAcpProcess(): Promise<void> {
    this.acpTransport?.dispose();
    this.acpTransport = null;
    this.acpInitializeResult = null;
    this.acpConfigKey = null;
    this.supportedCommands = [];

    if (this.acpProcess) {
      await this.acpProcess.shutdown().catch(() => {});
      this.acpProcess = null;
    }

    this.acpSessionId = null;
    this.activeAcpSessionId = null;
    this.activeAcpChunkSink = null;
  }

  private async ensureAcpSession(selectedModel: string): Promise<{ sessionId: string; createdNew: boolean }> {
    await this.ensureAcpProcess(selectedModel, this.currentExternalContextPaths);

    const transport = this.acpTransport;
    if (!transport) {
      throw new Error('ACP transport is not available');
    }

    const persistedDesiredModeId = this.currentConfigValues.mode ?? this.currentModeId;
    const persistedDesiredModelId = this.currentConfigValues.model ?? this.currentModelId;
    const requestedPermissionMode = String(
      (this.plugin.settings as unknown as Record<string, unknown>).permissionMode ?? 'normal',
    );

    const targetSessionId = this.desiredSessionId ?? this.acpSessionId;
    const cwd = this.plugin.app.vault.adapter && 'basePath' in this.plugin.app.vault.adapter
      ? (this.plugin.app.vault.adapter as { basePath: string }).basePath
      : process.cwd();

    if (targetSessionId) {
      if (this.acpSessionId === targetSessionId) {
        await this.applyDesiredSessionConfiguration(targetSessionId, selectedModel, {
          createdNew: false,
          requestedPermissionMode,
          persistedDesiredModeId,
          persistedDesiredModelId,
        });
        return { sessionId: targetSessionId, createdNew: false };
      }

      try {
        const loaded = await transport.request<CopilotAcpLoadSessionResponse>('session/load', {
          sessionId: targetSessionId,
          cwd,
          mcpServers: resolveCopilotAcpSessionMcpServers(this.currentActiveMcpServers),
        } satisfies CopilotAcpSessionReferenceRequest);
        this.acpSessionId = targetSessionId;
        this.captureSessionState(loaded);
        await this.applyDesiredSessionConfiguration(targetSessionId, selectedModel, {
          createdNew: false,
          persistedDesiredModeId,
          persistedDesiredModelId,
        });
        return { sessionId: targetSessionId, createdNew: false };
      } catch {
        this.sessionInvalidated = true;
      }
    }

    const created = await transport.request<CopilotAcpNewSessionResponse>('session/new', {
      cwd,
      mcpServers: resolveCopilotAcpSessionMcpServers(this.currentActiveMcpServers),
    } satisfies CopilotAcpNewSessionRequest);

    this.acpSessionId = created.sessionId;
    this.desiredSessionId = created.sessionId;
    this.captureSessionState(created);
    await this.applyDesiredSessionConfiguration(created.sessionId, selectedModel, {
      createdNew: true,
      requestedPermissionMode,
      persistedDesiredModeId,
      persistedDesiredModelId,
    });
    return { sessionId: created.sessionId, createdNew: true };
  }

  private async *runAcpTurn(
    selectedModel: string,
    prompt: string,
    conversationHistory: ChatMessage[],
    images?: ChatTurnRequest['images'],
  ): AsyncGenerator<StreamChunk> {
    const transport = this.acpTransport;
    const { sessionId, createdNew } = await this.ensureAcpSession(selectedModel);
    if (!transport) {
      throw new Error('ACP transport is not available');
    }

    const effectivePrompt = this.buildPromptWithConversationHistory(prompt, conversationHistory, createdNew);
  await this.mirrorAcpSessionImages(sessionId, images);

    const queue: StreamChunk[] = [];
    let wake: (() => void) | null = null;
    let done = false;
    let responseError: unknown = null;
    let sawOutput = false;

    const signal = (): void => {
      if (wake) {
        wake();
        wake = null;
      }
    };

    this.activeAcpSessionId = sessionId;
    this.activeAcpChunkSink = (chunk) => {
      sawOutput = true;
      queue.push(chunk);
      signal();
    };

    const promptPromise = transport.request<CopilotAcpPromptResponse>('session/prompt', {
      sessionId,
      prompt: buildCopilotAcpPromptContent(effectivePrompt, images),
    } satisfies CopilotAcpPromptRequest, 0).then(
      () => {
        done = true;
        signal();
      },
      (error) => {
        responseError = error;
        done = true;
        signal();
      },
    );

    try {
      while (true) {
        while (queue.length > 0) {
          yield queue.shift()!;
        }

        if (done || this.canceled) {
          break;
        }

        await new Promise<void>((resolve) => {
          wake = resolve;
        });
      }

      while (queue.length > 0) {
        yield queue.shift()!;
      }

      await promptPromise;

      if (this.canceled) {
        return;
      }

      const promptError = responseError;

      if (promptError) {
        const normalizedPromptError = promptError instanceof Error
          ? promptError
          : new Error(String(promptError));

        if (sawOutput) {
          const promptErrorMessage = normalizedPromptError.message;
          yield { type: 'error', content: promptErrorMessage };
          return;
        }
        throw normalizedPromptError;
      }
    } finally {
      this.activeAcpChunkSink = null;
      this.activeAcpSessionId = null;
    }
  }

  private handleAcpSessionUpdate(params: unknown): void {
    this.captureSessionStateFromNotification(params);

    if (!this.activeAcpChunkSink || !this.activeAcpSessionId) {
      return;
    }

    for (const normalized of normalizeCopilotAcpSessionUpdate(params)) {
      if (normalized.sessionId !== this.activeAcpSessionId) {
        continue;
      }
      this.activeAcpChunkSink(normalized.chunk);
    }
  }

  private async handleAcpPermissionRequest(
    params: CopilotAcpPermissionRequest,
  ): Promise<CopilotAcpPermissionResponse> {
    const decisionOptions = buildCopilotPermissionDecisionOptions(params.options);
    const toolCall = params.toolCall;
    const rawInput = toolCall?.rawInput ?? {};
    const description = toolCall?.title?.trim() || 'Copilot permission request';
    const toolName = typeof toolCall?.kind === 'string' && toolCall.kind.trim()
      ? `copilot_${toolCall.kind.trim()}`
      : 'copilot_permission';

    let decision: ApprovalDecision = 'deny';
    if (this.approvalCallback) {
      try {
        decision = await this.approvalCallback(toolName, rawInput, description, {
          decisionOptions,
          blockedPath: toolCall?.locations?.[0]?.path,
        });
      } finally {
        this.approvalDismisser?.();
      }
    }

    return {
      outcome: {
        optionId: resolveCopilotPermissionOutcomeOptionId(decision, params.options),
      },
    };
  }

  private async mirrorAcpSessionImages(
    sessionId: string,
    images?: ChatTurnRequest['images'],
  ): Promise<void> {
    if (!images || images.length === 0) {
      return;
    }

    const plan = buildCopilotSessionImageMirrorPlan(sessionId, images, os.homedir());
    if (plan.length === 0) {
      return;
    }

    const targetDir = path.dirname(plan[0].filePath);
    await fs.rm(targetDir, { recursive: true, force: true });
    await fs.mkdir(targetDir, { recursive: true });
    await Promise.all(plan.map((entry) => fs.writeFile(entry.filePath, entry.data)));
  }

  private captureSessionState(
    response: Pick<CopilotAcpLoadSessionResponse, 'models' | 'modes' | 'configOptions'>,
  ): void {
    if (response.models?.currentModelId) {
      this.currentModelId = response.models.currentModelId;
    }
    if (response.modes?.currentModeId) {
      this.currentModeId = response.modes.currentModeId;
      this.syncPermissionModeFromSession();
    }
    this.captureConfigValues(response.configOptions);
  }

  private captureConfigValues(configOptions: CopilotAcpSessionConfigOption[] | undefined): void {
    if (!configOptions) {
      return;
    }

    const nextValues = { ...this.currentConfigValues };
    for (const option of configOptions) {
      if (typeof option.id === 'string' && typeof option.currentValue === 'string') {
        nextValues[option.id] = option.currentValue;
      }
    }
    this.currentConfigValues = nextValues;
  }

  private captureSessionStateFromNotification(params: unknown): void {
    if (!params || typeof params !== 'object' || Array.isArray(params)) {
      return;
    }

    const notification = params as { update?: { sessionUpdate?: string; modeId?: string; modelId?: string; configId?: string; value?: string } };
    const update = notification.update;
    if (!update || typeof update.sessionUpdate !== 'string') {
      return;
    }

    if (update.sessionUpdate === 'current_mode_update' && typeof update.modeId === 'string') {
      this.currentModeId = update.modeId;
      this.currentConfigValues.mode = update.modeId;
      this.syncPermissionModeFromSession();
    }

    if (update.sessionUpdate === 'config_option_update'
      && typeof update.configId === 'string'
      && typeof update.value === 'string') {
      this.currentConfigValues[update.configId] = update.value;
      if (update.configId === 'model') {
        this.currentModelId = update.value;
      }
      if (update.configId === 'mode') {
        this.currentModeId = update.value;
        this.syncPermissionModeFromSession();
      }
    }

    if (update.sessionUpdate === 'available_commands_update') {
      this.supportedCommands = extractCopilotSupportedCommands(update);
    }
  }

  private async applyDesiredSessionConfiguration(
    sessionId: string,
    selectedModel: string,
    options: {
      createdNew: boolean;
      requestedPermissionMode: string | null;
      persistedDesiredModeId: string | null;
      persistedDesiredModelId: string | null;
    },
  ): Promise<void> {
    const transport = this.acpTransport;
    if (!transport) {
      return;
    }

    const uiDesiredModeId = resolveDesiredCopilotSessionModeId(
      options.requestedPermissionMode,
      options.persistedDesiredModeId,
    );
    const desiredModeId = uiDesiredModeId;

    if (desiredModeId && desiredModeId !== this.currentModeId) {
      const result = await transport.request<CopilotAcpSetModeResponse>('session/set_mode', {
        sessionId,
        modeId: desiredModeId,
      });
      this.captureSessionState(result);
    }

    const desiredModelId = resolveDesiredCopilotSessionModel(
      selectedModel,
      options.persistedDesiredModelId,
    );

    if (desiredModelId && desiredModelId !== this.currentModelId) {
      const result = await transport.request<CopilotAcpSetConfigOptionResponse>('session/set_config_option', {
        sessionId,
        configId: 'model',
        value: desiredModelId,
      });
      this.captureSessionState(result);
      this.currentModelId = desiredModelId;
      this.currentConfigValues.model = desiredModelId;
    }
  }

  private syncPermissionModeFromSession(): void {
    if (!this.permissionModeSyncCallback || !this.currentModeId) {
      return;
    }

    try {
      const sdkMode = resolveCopilotSdkPermissionMode(this.currentModeId);
      if (sdkMode) {
        this.permissionModeSyncCallback(sdkMode);
      }
    } catch {
      // Non-critical UI sync.
    }
  }

  private mapPermissionModeToSessionMode(mode: string): string | null {
    return resolveCopilotSessionModeId(mode);
  }

  private mapSessionModeToPermissionMode(modeId: string): string {
    return resolveCopilotPermissionMode(modeId) ?? 'normal';
  }

  private buildPromptWithConversationHistory(
    prompt: string,
    conversationHistory: ChatMessage[],
    includeHistory: boolean,
  ): string {
    if (!includeHistory || conversationHistory.length === 0) {
      return prompt;
    }

    const transcript = conversationHistory
      .map((message) => `${message.role.toUpperCase()}: ${message.content}`.trim())
      .join('\n\n');

    return [
      'Continue this conversation with the following prior transcript as context.',
      '',
      transcript,
      ...(prompt ? ['', `USER: ${prompt}`] : []),
    ].join('\n');
  }

  private getVaultPath(): string | null {
    const adapter = this.plugin.app.vault.adapter;
    if (adapter && 'basePath' in adapter && typeof adapter.basePath === 'string') {
      return adapter.basePath;
    }
    return null;
  }

  private async *runPromptProcess(launchSpec: CopilotLaunchSpec): AsyncGenerator<StreamChunk> {
    const process = new CopilotCliProcess(launchSpec);
    const queue: StreamChunk[] = [];
    const stderrChunks: string[] = [];
    let processError: Error | null = null;
    let exitCode: number | null | undefined;
    let exitSignal: string | null = null;
    let wake: (() => void) | null = null;

    const signal = (): void => {
      if (wake) {
        wake();
        wake = null;
      }
    };

    const enqueue = (chunk: StreamChunk): void => {
      queue.push(chunk);
      signal();
    };

    const attachStream = (stream: Readable, onChunk: (content: string) => void): void => {
      stream.setEncoding('utf8');
      stream.on('data', (chunk: string | Buffer) => {
        const content = typeof chunk === 'string' ? chunk : chunk.toString('utf8');
        if (content) {
          onChunk(content);
        }
      });
    };

    process.onExit((code, signalName) => {
      exitCode = code;
      exitSignal = signalName;
      signal();
    });
    process.onError((error) => {
      processError = error;
      signal();
    });

    process.start();
    this.activePromptProcess = process;

    try {
      attachStream(process.stdout, (content) => {
        if (!this.canceled) {
          enqueue({ type: 'text', content });
        }
      });
      attachStream(process.stderr, (content) => {
        stderrChunks.push(content);
      });
    } catch (error) {
      processError = error instanceof Error ? error : new Error(String(error));
      signal();
    }

    try {
      while (true) {
        while (queue.length > 0) {
          yield queue.shift()!;
        }

        if (processError || exitCode !== undefined || this.canceled) {
          break;
        }

        await new Promise<void>((resolve) => {
          wake = resolve;
        });
      }

      while (queue.length > 0) {
        yield queue.shift()!;
      }

      if (this.canceled) {
        return;
      }

      const stderrText = stderrChunks.join('').trim();
      const launchError = processError;
      const finalExitCode = exitCode;
      const finalExitSignal = exitSignal;

      if (launchError) {
        yield { type: 'error', content: `Failed to launch Copilot CLI: ${launchError.message}` };
        return;
      }

      if (finalExitCode !== undefined && finalExitCode !== null && finalExitCode !== 0) {
        yield {
          type: 'error',
          content: stderrText || `Copilot CLI exited with code ${finalExitCode}${finalExitSignal ? ` (${finalExitSignal})` : ''}.`,
        };
        return;
      }

      if (stderrText) {
        yield { type: 'notice', level: 'warning', content: stderrText };
      }
    } finally {
      this.activePromptProcess = null;
      await process.shutdown().catch(() => {});
    }
  }

  private setReady(ready: boolean): void {
    if (this.ready === ready) {
      return;
    }

    this.ready = ready;
    for (const listener of this.readyListeners) {
      try {
        listener(ready);
      } catch {
        // Ignore listener errors.
      }
    }
  }
}