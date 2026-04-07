import type { ProviderConversationHistoryService } from '../../../core/providers/types';
import type { ChatMessage, Conversation } from '../../../core/types';
import { getCopilotState } from '../types';

function cloneMessages(messages: ChatMessage[]): ChatMessage[] {
  const sc = (globalThis as unknown as { structuredClone?: <T>(value: T) => T }).structuredClone;
  if (typeof sc === 'function') {
    return sc(messages);
  }
  return JSON.parse(JSON.stringify(messages)) as ChatMessage[];
}

export class CopilotConversationHistoryService implements ProviderConversationHistoryService {
  async hydrateConversationHistory(
    conversation: Conversation,
    _vaultPath: string | null,
  ): Promise<void> {
    if (conversation.messages.length > 0) {
      return;
    }

    const state = getCopilotState(conversation.providerState);
    if (!state.persistedMessages || state.persistedMessages.length === 0) {
      return;
    }

    conversation.messages = cloneMessages(state.persistedMessages);
  }

  async deleteConversationSession(
    _conversation: Conversation,
    _vaultPath: string | null,
  ): Promise<void> {
    // Scaffold phase: no provider-native session artifacts to delete.
  }

  resolveSessionIdForConversation(conversation: Conversation | null): string | null {
    if (!conversation) {
      return null;
    }

    const state = getCopilotState(conversation.providerState);
    return conversation.sessionId ?? state.forkSource?.sessionId ?? null;
  }

  isPendingForkConversation(conversation: Conversation): boolean {
    const state = getCopilotState(conversation.providerState);
    return !!state.forkSource && !conversation.sessionId;
  }

  buildForkProviderState(
    sourceSessionId: string,
    resumeAt: string,
    sourceProviderState?: Record<string, unknown>,
  ): Record<string, unknown> {
    const sourceState = getCopilotState(sourceProviderState);
    const providerState = {
      ...(sourceState.currentModeId ? { currentModeId: sourceState.currentModeId } : {}),
      ...(sourceState.currentModelId ? { currentModelId: sourceState.currentModelId } : {}),
      ...(sourceState.configValues ? { configValues: sourceState.configValues } : {}),
      forkSource: { sessionId: sourceSessionId, resumeAt },
    };

    return providerState;
  }

  buildPersistedProviderState(
    conversation: Conversation,
  ): Record<string, unknown> | undefined {
    const persistedMessages = conversation.messages.length > 0
      ? cloneMessages(conversation.messages)
      : undefined;

    const providerState = {
      ...(conversation.providerState ?? {}),
      ...(persistedMessages ? { persistedMessages } : {}),
    };

    return Object.keys(providerState).length > 0 ? providerState : undefined;
  }
}