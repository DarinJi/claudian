import type { Readable } from 'stream';

import { ProviderSettingsCoordinator } from '../../../core/providers/ProviderSettingsCoordinator';
import type { ProviderCapabilities, ProviderId } from '../../../core/providers/types';
import type { ChatRuntime } from '../../../core/runtime/ChatRuntime';
import type {
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
  ChatMessage,
  Conversation,
  ConversationMeta,
  SlashCommand,
  StreamChunk,
  ToolCallInfo,
} from '../../../core/types';
import type ClaudianPlugin from '../../../main';
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
import type { CopilotAcpInitializeResult } from './copilotAcpTypes';
import type {
  CopilotAcpListSessionsResponse,
  CopilotAcpLoadSessionResponse,
  CopilotAcpNewSessionResponse,
  CopilotAcpPromptResponse,
  CopilotAcpSessionConfigOption,
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

export function resolveDesiredCopilotSessionModel(
  selectedModel: string,
  persistedDesiredModelId: string | null,
): string {
  return selectedModel || persistedDesiredModelId || resolveActualCopilotModel(DEFAULT_COPILOT_MODEL);
}

export class CopilotChatRuntime implements ChatRuntime {
  readonly providerId: ProviderId = 'copilot';

  private plugin: ClaudianPlugin;
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
  private currentModeId: string | null = null;
  private currentModelId: string | null = null;
  private currentConfigValues: Record<string, string> = {};

  constructor(plugin: ClaudianPlugin) {
    this.plugin = plugin;
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
    _externalContextPaths?: string[],
  ): void {
    if (!conversation) {
      this.desiredSessionId = null;
      this.acpSessionId = null;
      this.currentModeId = null;
      this.currentModelId = null;
      this.currentConfigValues = {};
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

    this.currentModeId = state.currentModeId ?? null;
    this.currentModelId = state.currentModelId ?? null;
    this.currentConfigValues = { ...(state.configValues ?? {}) };
  }

  async reloadMcpServers(): Promise<void> {
    // Copilot CLI owns MCP loading. A future ACP turn implementation can add explicit reloads.
  }

  async ensureReady(_options?: ChatRuntimeEnsureReadyOptions): Promise<boolean> {
    const cliPath = this.plugin.getResolvedProviderCliPath(this.providerId);
    const providerSettings = this.getProviderSettings();
    const copilotSettings = getCopilotProviderSettings(providerSettings);
    const hasCli = Boolean(cliPath && cliPath.trim().length > 0);

    this.acpWarning = null;

    if (hasCli && copilotSettings.useACP) {
      try {
        const defaultModel = this.resolveModel();
        await this.ensureAcpProcess(defaultModel);
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
    const ready = await this.ensureReady();
    const selectedModel = this.resolveModel(queryOptions);
    const prompt = turn.prompt.trim();
    const history = conversationHistory ?? [];

    yield { type: 'assistant_message_start' };

    if (!ready) {
      yield { type: 'error', content: 'Copilot provider is not ready. Configure the Copilot CLI path in settings before using this provider.' };
      yield { type: 'done' };
      return;
    }

    if (!prompt) {
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

    if (this.canceled) {
      yield { type: 'done' };
      return;
    }

    const externalContextPaths = [
      ...(turn.request.externalContextPaths ?? []),
      ...(queryOptions?.externalContextPaths ?? []),
    ];

    if (getCopilotProviderSettings(providerSettings).useACP
      && !this.acpWarning
      && externalContextPaths.length === 0) {
      try {
        for await (const chunk of this.runAcpTurn(selectedModel, prompt, history)) {
          yield chunk;
        }
        yield { type: 'done' };
        return;
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        yield {
          type: 'notice',
          level: 'warning',
          content: `ACP turn failed, falling back to prompt mode: ${message}`,
        };
      }
    } else if (externalContextPaths.length > 0 && getCopilotProviderSettings(providerSettings).useACP) {
      yield {
        type: 'notice',
        level: 'info',
        content: 'Using prompt fallback because this turn includes external context paths that are not yet wired into the ACP session flow.',
      };
    }

    const launchSpec = resolveCopilotPromptLaunchSpec(this.plugin, {
      prompt: this.buildPromptWithConversationHistory(prompt, history, !this.desiredSessionId && history.length > 0),
      model: selectedModel,
      allowedTools: queryOptions?.allowedTools,
      externalContextPaths,
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
    this.currentModeId = null;
    this.currentModelId = null;
    this.currentConfigValues = {};
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
    return [];
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

  private async ensureAcpProcess(selectedModel: string): Promise<void> {
    const launchSpec = resolveCopilotAcpLaunchSpec(this.plugin, selectedModel);
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

    if (this.acpProcess) {
      await this.acpProcess.shutdown().catch(() => {});
      this.acpProcess = null;
    }

    this.acpSessionId = null;
    this.activeAcpSessionId = null;
    this.activeAcpChunkSink = null;
  }

  private async ensureAcpSession(selectedModel: string): Promise<{ sessionId: string; createdNew: boolean }> {
    await this.ensureAcpProcess(selectedModel);

    const transport = this.acpTransport;
    if (!transport) {
      throw new Error('ACP transport is not available');
    }

    const persistedDesiredModeId = this.currentConfigValues.mode ?? this.currentModeId;
    const persistedDesiredModelId = this.currentConfigValues.model ?? this.currentModelId;

    const targetSessionId = this.desiredSessionId ?? this.acpSessionId;
    const cwd = this.plugin.app.vault.adapter && 'basePath' in this.plugin.app.vault.adapter
      ? (this.plugin.app.vault.adapter as { basePath: string }).basePath
      : process.cwd();

    if (targetSessionId) {
      if (this.acpSessionId === targetSessionId) {
        await this.applyDesiredSessionConfiguration(targetSessionId, selectedModel, {
          createdNew: false,
          persistedDesiredModeId,
          persistedDesiredModelId,
        });
        return { sessionId: targetSessionId, createdNew: false };
      }

      try {
        const loaded = await transport.request<CopilotAcpLoadSessionResponse>('session/load', {
          sessionId: targetSessionId,
          cwd,
          mcpServers: [],
        });
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
      mcpServers: [],
    });

    this.acpSessionId = created.sessionId;
    this.desiredSessionId = created.sessionId;
    this.captureSessionState(created);
    await this.applyDesiredSessionConfiguration(created.sessionId, selectedModel, {
      createdNew: true,
      persistedDesiredModeId,
      persistedDesiredModelId,
    });
    return { sessionId: created.sessionId, createdNew: true };
  }

  private async *runAcpTurn(
    selectedModel: string,
    prompt: string,
    conversationHistory: ChatMessage[],
  ): AsyncGenerator<StreamChunk> {
    const transport = this.acpTransport;
    const { sessionId, createdNew } = await this.ensureAcpSession(selectedModel);
    if (!transport) {
      throw new Error('ACP transport is not available');
    }

    const effectivePrompt = this.buildPromptWithConversationHistory(prompt, conversationHistory, createdNew);

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
      prompt: [{ type: 'text', text: effectivePrompt }],
    }, 0).then(
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
  }

  private async applyDesiredSessionConfiguration(
    sessionId: string,
    selectedModel: string,
    options: {
      createdNew: boolean;
      persistedDesiredModeId: string | null;
      persistedDesiredModelId: string | null;
    },
  ): Promise<void> {
    const transport = this.acpTransport;
    if (!transport) {
      return;
    }

    const uiDesiredModeId = this.mapPermissionModeToSessionMode(
      String((this.plugin.settings as unknown as Record<string, unknown>).permissionMode ?? 'normal'),
    );
    const desiredModeId = options.createdNew
      ? (options.persistedDesiredModeId ?? uiDesiredModeId)
      : options.persistedDesiredModeId;

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
      this.permissionModeSyncCallback(this.mapSessionModeToPermissionMode(this.currentModeId));
    } catch {
      // Non-critical UI sync.
    }
  }

  private mapPermissionModeToSessionMode(mode: string): string | null {
    if (mode === 'plan') {
      return 'https://agentclientprotocol.com/protocol/session-modes#plan';
    }
    if (mode === 'yolo') {
      return 'https://agentclientprotocol.com/protocol/session-modes#autopilot';
    }
    return 'https://agentclientprotocol.com/protocol/session-modes#agent';
  }

  private mapSessionModeToPermissionMode(modeId: string): string {
    if (modeId.endsWith('#plan')) {
      return 'plan';
    }
    if (modeId.endsWith('#autopilot')) {
      return 'yolo';
    }
    return 'normal';
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
      '',
      `USER: ${prompt}`,
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