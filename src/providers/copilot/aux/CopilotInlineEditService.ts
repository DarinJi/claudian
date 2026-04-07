import type {
  InlineEditRequest,
  InlineEditResult,
  InlineEditService,
} from '../../../core/providers/types';
import {
  buildInlineEditPrompt,
  getInlineEditSystemPrompt,
  parseInlineEditResponse,
} from '../../../core/prompt/inlineEdit';
import { READ_ONLY_TOOLS } from '../../../core/tools/toolNames';
import type ClaudianPlugin from '../../../main';
import { appendContextFiles } from '../../../utils/context';
import { CopilotAuxQueryRunner } from '../runtime/CopilotAuxQueryRunner';

export class CopilotInlineEditService implements InlineEditService {
  private runner: CopilotAuxQueryRunner;
  private abortController: AbortController | null = null;
  private hasConversation = false;

  constructor(plugin: ClaudianPlugin) {
    this.runner = new CopilotAuxQueryRunner(plugin);
  }

  resetConversation(): void {
    this.runner.reset();
    this.hasConversation = false;
  }

  async editText(request: InlineEditRequest): Promise<InlineEditResult> {
    this.resetConversation();
    const prompt = buildInlineEditPrompt(request);
    return this.sendMessage(prompt, request.contextFiles);
  }

  async continueConversation(message: string, contextFiles?: string[]): Promise<InlineEditResult> {
    if (!this.hasConversation) {
      return {
        success: false,
        error: 'No active conversation to continue',
      };
    }

    let prompt = message;
    if (contextFiles && contextFiles.length > 0) {
      prompt = appendContextFiles(message, contextFiles);
    }

    return this.sendMessage(prompt, contextFiles);
  }

  cancel(): void {
    if (this.abortController) {
      this.abortController.abort();
      this.abortController = null;
    }
  }

  private async sendMessage(prompt: string, contextFiles?: string[]): Promise<InlineEditResult> {
    this.abortController = new AbortController();

    try {
      const text = await this.runner.query({
        systemPrompt: getInlineEditSystemPrompt(),
        abortController: this.abortController,
        allowedTools: [...READ_ONLY_TOOLS],
        externalContextPaths: contextFiles,
      }, prompt);

      this.hasConversation = true;
      return parseInlineEditResponse(text);
    } catch (error) {
      const msg = error instanceof Error ? error.message : 'Unknown error';
      return { success: false, error: msg };
    } finally {
      this.abortController = null;
    }
  }
}