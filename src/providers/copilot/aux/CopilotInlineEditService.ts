import type {
  InlineEditRequest,
  InlineEditResult,
  InlineEditService,
} from '../../../core/providers/types';

const NOT_SUPPORTED_MESSAGE = 'Inline edit for the Copilot provider is not implemented yet.';

export class CopilotInlineEditService implements InlineEditService {
  resetConversation(): void {
    // No-op in scaffold phase.
  }

  async editText(_request: InlineEditRequest): Promise<InlineEditResult> {
    return {
      success: false,
      error: NOT_SUPPORTED_MESSAGE,
    };
  }

  async continueConversation(_message: string): Promise<InlineEditResult> {
    return {
      success: false,
      error: NOT_SUPPORTED_MESSAGE,
    };
  }

  cancel(): void {
    // No-op in scaffold phase.
  }
}