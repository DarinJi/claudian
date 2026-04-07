import type { Readable } from 'stream';

import { ProviderSettingsCoordinator } from '../../../core/providers/ProviderSettingsCoordinator';
import type ClaudianPlugin from '../../../main';
import { resolveCopilotPromptLaunchSpec } from './copilotAcpSupport';
import { CopilotCliProcess } from './CopilotCliProcess';
import { resolveCopilotRuntimeModel } from './CopilotChatRuntime';

export interface CopilotAuxQueryConfig {
  systemPrompt: string;
  model?: string;
  abortController?: AbortController;
  onTextChunk?: (accumulatedText: string) => void;
  allowedTools?: string[];
  externalContextPaths?: string[];
}

interface AuxTranscriptMessage {
  role: 'user' | 'assistant';
  content: string;
}

export class CopilotAuxQueryRunner {
  private transcript: AuxTranscriptMessage[] = [];
  private activeProcess: CopilotCliProcess | null = null;

  constructor(private readonly plugin: ClaudianPlugin) {}

  async query(config: CopilotAuxQueryConfig, prompt: string): Promise<string> {
    if (config.abortController?.signal.aborted) {
      throw new Error('Cancelled');
    }

    const effectivePrompt = this.buildPrompt(config.systemPrompt, prompt);
    const launchSpec = resolveCopilotPromptLaunchSpec(this.plugin, {
      prompt: effectivePrompt,
      model: config.model ?? this.resolveProviderModel(),
      allowedTools: config.allowedTools,
      externalContextPaths: config.externalContextPaths,
    });

    const text = await this.runPromptProcess(launchSpec, config);

    this.transcript.push({ role: 'user', content: prompt });
    this.transcript.push({ role: 'assistant', content: text });

    return text;
  }

  reset(): void {
    this.transcript = [];
    if (this.activeProcess) {
      void this.activeProcess.shutdown().catch(() => {});
      this.activeProcess = null;
    }
  }

  private resolveProviderModel(): string {
    const providerSettings = ProviderSettingsCoordinator.getProviderSettingsSnapshot(
      this.plugin.settings as unknown as Record<string, unknown>,
      'copilot',
    );
    const providerModel = typeof providerSettings.model === 'string'
      ? providerSettings.model
      : undefined;
    return resolveCopilotRuntimeModel(undefined, providerModel);
  }

  private buildPrompt(systemPrompt: string, prompt: string): string {
    const parts = [
      'Follow the system instructions exactly.',
      '',
      '<system_instructions>',
      systemPrompt.trim(),
      '</system_instructions>',
    ];

    if (this.transcript.length > 0) {
      const transcript = this.transcript
        .map((message) => `${message.role.toUpperCase()}:\n${message.content}`.trim())
        .join('\n\n');

      parts.push(
        '',
        '<conversation_history>',
        transcript,
        '</conversation_history>',
      );
    }

    parts.push(
      '',
      '<user_message>',
      prompt,
      '</user_message>',
    );

    return parts.join('\n');
  }

  private async runPromptProcess(
    launchSpec: ReturnType<typeof resolveCopilotPromptLaunchSpec>,
    config: CopilotAuxQueryConfig,
  ): Promise<string> {
    const process = new CopilotCliProcess(launchSpec);
    this.activeProcess = process;

    let accumulatedText = '';
    const stderrChunks: string[] = [];
    let processErrorMessage: string | null = null;
    let exitCode: number | null | undefined;
    let exitSignal: string | null = null;
    let resolveWait: (() => void) | null = null;

    const donePromise = new Promise<void>((resolve) => {
      resolveWait = resolve;
    });

    const signalDone = (): void => {
      resolveWait?.();
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

    process.onExit((code, signal) => {
      exitCode = code;
      exitSignal = signal;
      signalDone();
    });

    process.onError((error) => {
      processErrorMessage = error.message;
      signalDone();
    });

    const abortHandler = (): void => {
      void process.shutdown().catch(() => {});
      signalDone();
    };

    config.abortController?.signal.addEventListener('abort', abortHandler, { once: true });

    try {
      process.start();

      attachStream(process.stdout, (content) => {
        accumulatedText += content;
        config.onTextChunk?.(accumulatedText);
      });
      attachStream(process.stderr, (content) => {
        stderrChunks.push(content);
      });

      await donePromise;

      if (config.abortController?.signal.aborted) {
        throw new Error('Cancelled');
      }

      if (processErrorMessage) {
        throw new Error(`Failed to launch Copilot CLI: ${processErrorMessage}`);
      }

      if (exitCode !== undefined && exitCode !== null && exitCode !== 0) {
        const stderrText = stderrChunks.join('').trim();
        throw new Error(
          stderrText || `Copilot CLI exited with code ${exitCode}${exitSignal ? ` (${exitSignal})` : ''}.`,
        );
      }

      return accumulatedText;
    } finally {
      config.abortController?.signal.removeEventListener('abort', abortHandler);
      this.activeProcess = null;
      await process.shutdown().catch(() => {});
    }
  }
}