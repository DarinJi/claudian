import type { StreamChunk } from '../../../core/types';
import type {
  CopilotAcpContentBlock,
  CopilotAcpSessionUpdate,
  CopilotAcpSessionUpdateNotification,
  CopilotAcpToolCallUpdateContentEntry,
} from './copilotAcpTypes';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function extractTextFromContentBlock(content: CopilotAcpContentBlock | undefined): string | null {
  if (!content || content.type !== 'text' || typeof content.text !== 'string') {
    return null;
  }
  return content.text;
}

function extractToolResultText(entries: CopilotAcpToolCallUpdateContentEntry[] | undefined): string | null {
  if (!Array.isArray(entries) || entries.length === 0) {
    return null;
  }

  const text = entries
    .map((entry) => extractTextFromContentBlock(entry.content))
    .filter((value): value is string => typeof value === 'string' && value.length > 0)
    .join('\n')
    .trim();

  return text || null;
}

export function normalizeCopilotAcpSessionUpdate(
  params: unknown,
): Array<{ sessionId: string; chunk: StreamChunk }> {
  if (!isRecord(params) || typeof params.sessionId !== 'string' || !isRecord(params.update)) {
    return [];
  }

  const notification = params as unknown as CopilotAcpSessionUpdateNotification;
  const update = notification.update;

  switch (update.sessionUpdate) {
    case 'agent_message_chunk': {
      const textUpdate = update as Extract<
        CopilotAcpSessionUpdate,
        { sessionUpdate: 'agent_message_chunk' | 'agent_thought_chunk' | 'user_message_chunk' }
      >;
      const text = extractTextFromContentBlock(textUpdate.content);
      return text ? [{ sessionId: notification.sessionId, chunk: { type: 'text', content: text } }] : [];
    }
    case 'agent_thought_chunk': {
      const thoughtUpdate = update as Extract<
        CopilotAcpSessionUpdate,
        { sessionUpdate: 'agent_message_chunk' | 'agent_thought_chunk' | 'user_message_chunk' }
      >;
      const text = extractTextFromContentBlock(thoughtUpdate.content);
      return text ? [{ sessionId: notification.sessionId, chunk: { type: 'thinking', content: text } }] : [];
    }
    case 'tool_call': {
      const toolCallUpdate = update as Extract<CopilotAcpSessionUpdate, { sessionUpdate: 'tool_call' }>;

      if (typeof toolCallUpdate.toolCallId !== 'string') {
        return [];
      }

      return [{
        sessionId: notification.sessionId,
        chunk: {
          type: 'tool_use',
          id: toolCallUpdate.toolCallId,
          name: toolCallUpdate.kind || toolCallUpdate.title || 'tool',
          input: isRecord(toolCallUpdate.rawInput) ? toolCallUpdate.rawInput : {},
        },
      }];
    }
    case 'tool_call_update': {
      const toolResultUpdate = update as Extract<CopilotAcpSessionUpdate, { sessionUpdate: 'tool_call_update' }>;

      if (typeof toolResultUpdate.toolCallId !== 'string') {
        return [];
      }

      const content = toolResultUpdate.rawOutput?.detailedContent
        || toolResultUpdate.rawOutput?.content
        || extractToolResultText(toolResultUpdate.content)
        || toolResultUpdate.status
        || '';

      if (!content) {
        return [];
      }

      return [{
        sessionId: notification.sessionId,
        chunk: {
          type: 'tool_result',
          id: toolResultUpdate.toolCallId,
          content,
          isError: toolResultUpdate.status === 'failed' || toolResultUpdate.status === 'cancelled',
        },
      }];
    }
    default:
      return [];
  }
}