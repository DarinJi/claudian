import type {
  InstructionRefineService,
  RefineProgressCallback,
} from '../../../core/providers/types';
import { buildRefineSystemPrompt } from '../../../core/prompt/instructionRefine';
import type { InstructionRefineResult } from '../../../core/types';
import type ClaudianPlugin from '../../../main';
import { CopilotAuxQueryRunner } from '../runtime/CopilotAuxQueryRunner';

export class CopilotInstructionRefineService implements InstructionRefineService {
  private runner: CopilotAuxQueryRunner;
  private abortController: AbortController | null = null;
  private existingInstructions = '';
  private hasConversation = false;

  constructor(plugin: ClaudianPlugin) {
    this.runner = new CopilotAuxQueryRunner(plugin);
  }

  resetConversation(): void {
    this.runner.reset();
    this.hasConversation = false;
  }

  async refineInstruction(
    rawInstruction: string,
    existingInstructions: string,
    onProgress?: RefineProgressCallback,
  ): Promise<InstructionRefineResult> {
    this.resetConversation();
    this.existingInstructions = existingInstructions;
    const prompt = `Please refine this instruction: "${rawInstruction}"`;
    return this.sendMessage(prompt, onProgress);
  }

  async continueConversation(
    message: string,
    onProgress?: RefineProgressCallback,
  ): Promise<InstructionRefineResult> {
    if (!this.hasConversation) {
      return { success: false, error: 'No active conversation to continue' };
    }

    return this.sendMessage(message, onProgress);
  }

  cancel(): void {
    if (this.abortController) {
      this.abortController.abort();
      this.abortController = null;
    }
  }

  private async sendMessage(
    prompt: string,
    onProgress?: RefineProgressCallback,
  ): Promise<InstructionRefineResult> {
    this.abortController = new AbortController();

    try {
      const text = await this.runner.query({
        systemPrompt: buildRefineSystemPrompt(this.existingInstructions),
        abortController: this.abortController,
        onTextChunk: onProgress
          ? (accumulatedText: string) => onProgress(this.parseResponse(accumulatedText))
          : undefined,
      }, prompt);

      this.hasConversation = true;
      return this.parseResponse(text);
    } catch (error) {
      const msg = error instanceof Error ? error.message : 'Unknown error';
      return { success: false, error: msg };
    } finally {
      this.abortController = null;
    }
  }

  private parseResponse(text: string): InstructionRefineResult {
    const instructionMatch = text.match(/<instruction>([\s\S]*?)<\/instruction>/);
    if (instructionMatch) {
      return { success: true, refinedInstruction: instructionMatch[1].trim() };
    }

    const trimmed = text.trim();
    if (trimmed) {
      return { success: true, clarification: trimmed };
    }

    return { success: false, error: 'Empty response' };
  }
}