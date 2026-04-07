import type {
  TitleGenerationCallback,
  TitleGenerationService,
} from '../../../core/providers/types';

export class CopilotTitleGenerationService implements TitleGenerationService {
  async generateTitle(
    conversationId: string,
    userMessage: string,
    callback: TitleGenerationCallback,
  ): Promise<void> {
    const compact = userMessage
      .replace(/\s+/g, ' ')
      .trim()
      .replace(/[.!?:;,]+$/, '');
    const fallbackTitle = (compact || 'New Copilot conversation').slice(0, 50);

    await callback(conversationId, {
      success: true,
      title: fallbackTitle,
    });
  }

  cancel(): void {
    // No-op for local fallback title generation.
  }
}