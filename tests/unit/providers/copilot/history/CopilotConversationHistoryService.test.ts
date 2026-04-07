import type { ChatMessage, Conversation } from '@/core/types';
import { CopilotConversationHistoryService } from '@/providers/copilot/history/CopilotConversationHistoryService';

function createMessages(): ChatMessage[] {
  return [
    {
      id: 'user-1',
      role: 'user',
      content: 'Summarize CLAUDE.md',
      timestamp: 1700000000000,
    },
    {
      id: 'assistant-1',
      role: 'assistant',
      content: 'Summary text',
      timestamp: 1700000001000,
      contentBlocks: [{ type: 'text', content: 'Summary text' }],
    },
  ];
}

describe('CopilotConversationHistoryService', () => {
  it('hydrates conversation messages from persisted provider state', async () => {
    const persistedMessages = createMessages();
    const conversation: Conversation = {
      id: 'copilot-conv-1',
      providerId: 'copilot',
      title: 'Copilot Session',
      createdAt: 1700000000000,
      updatedAt: 1700000000000,
      sessionId: 'session-1',
      providerState: {
        persistedMessages,
      },
      messages: [],
    };

    const service = new CopilotConversationHistoryService();
    await service.hydrateConversationHistory(conversation, null);

    expect(conversation.messages).toEqual(persistedMessages);
    expect(conversation.messages).not.toBe(persistedMessages);
  });

  it('preserves existing in-memory messages when already hydrated', async () => {
    const persistedMessages = createMessages();
    const inMemoryMessages = [
      {
        id: 'live-1',
        role: 'assistant' as const,
        content: 'Live content',
        timestamp: 1700000002000,
      },
    ];
    const conversation: Conversation = {
      id: 'copilot-conv-2',
      providerId: 'copilot',
      title: 'Hydrated Session',
      createdAt: 1700000000000,
      updatedAt: 1700000000000,
      sessionId: 'session-2',
      providerState: {
        persistedMessages,
      },
      messages: inMemoryMessages,
    };

    const service = new CopilotConversationHistoryService();
    await service.hydrateConversationHistory(conversation, null);

    expect(conversation.messages).toBe(inMemoryMessages);
  });

  it('builds persisted provider state with a message snapshot', () => {
    const messages = createMessages();
    const conversation: Conversation = {
      id: 'copilot-conv-3',
      providerId: 'copilot',
      title: 'Persisted Session',
      createdAt: 1700000000000,
      updatedAt: 1700000000000,
      sessionId: 'session-3',
      providerState: {
        customValue: 'keep-me',
      },
      messages,
    };

    const service = new CopilotConversationHistoryService();
    const state = service.buildPersistedProviderState(conversation);

    expect(state).toEqual({
      customValue: 'keep-me',
      persistedMessages: messages,
    });
    expect((state as Record<string, unknown>).persistedMessages).not.toBe(messages);
  });

  it('marks fork conversations without session id as pending', () => {
    const conversation: Conversation = {
      id: 'copilot-fork-1',
      providerId: 'copilot',
      title: 'Fork Pending',
      createdAt: 1700000000000,
      updatedAt: 1700000000000,
      sessionId: null,
      providerState: {
        forkSource: {
          sessionId: 'source-session',
          resumeAt: 'assistant-uuid',
        },
      },
      messages: createMessages(),
    };

    const service = new CopilotConversationHistoryService();
    expect(service.isPendingForkConversation(conversation)).toBe(true);
    expect(service.resolveSessionIdForConversation(conversation)).toBe('source-session');
  });

  it('builds fork provider state preserving mode and model metadata', () => {
    const service = new CopilotConversationHistoryService();
    const state = service.buildForkProviderState('source-session', 'assistant-uuid', {
      currentModeId: 'https://agentclientprotocol.com/protocol/session-modes#plan',
      currentModelId: 'claude-sonnet-4.5',
      configValues: {
        model: 'claude-sonnet-4.5',
      },
    });

    expect(state).toEqual({
      currentModeId: 'https://agentclientprotocol.com/protocol/session-modes#plan',
      currentModelId: 'claude-sonnet-4.5',
      configValues: {
        model: 'claude-sonnet-4.5',
      },
      forkSource: {
        sessionId: 'source-session',
        resumeAt: 'assistant-uuid',
      },
    });
  });
});