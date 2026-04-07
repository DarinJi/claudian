import { normalizeCopilotAcpSessionUpdate } from '@/providers/copilot/runtime/CopilotAcpSessionUpdateNormalizer';

describe('CopilotAcpSessionUpdateNormalizer', () => {
  it('normalizes agent text chunks into text stream chunks', () => {
    expect(normalizeCopilotAcpSessionUpdate({
      sessionId: 'session-1',
      update: {
        sessionUpdate: 'agent_message_chunk',
        content: { type: 'text', text: 'hello' },
      },
    })).toEqual([
      {
        sessionId: 'session-1',
        chunk: { type: 'text', content: 'hello' },
      },
    ]);
  });

  it('normalizes agent thought chunks into thinking stream chunks', () => {
    expect(normalizeCopilotAcpSessionUpdate({
      sessionId: 'session-1',
      update: {
        sessionUpdate: 'agent_thought_chunk',
        content: { type: 'text', text: 'thinking' },
      },
    })).toEqual([
      {
        sessionId: 'session-1',
        chunk: { type: 'thinking', content: 'thinking' },
      },
    ]);
  });

  it('normalizes tool calls into tool_use chunks', () => {
    expect(normalizeCopilotAcpSessionUpdate({
      sessionId: 'session-1',
      update: {
        sessionUpdate: 'tool_call',
        toolCallId: 'tool-1',
        kind: 'read',
        rawInput: { path: '/tmp/file.txt' },
      },
    })).toEqual([
      {
        sessionId: 'session-1',
        chunk: {
          type: 'tool_use',
          id: 'tool-1',
          name: 'read',
          input: { path: '/tmp/file.txt' },
        },
      },
    ]);
  });

  it('normalizes tool call updates into tool_result chunks', () => {
    expect(normalizeCopilotAcpSessionUpdate({
      sessionId: 'session-1',
      update: {
        sessionUpdate: 'tool_call_update',
        toolCallId: 'tool-1',
        status: 'completed',
        rawOutput: { detailedContent: '/tmp/file.txt:# heading' },
      },
    })).toEqual([
      {
        sessionId: 'session-1',
        chunk: {
          type: 'tool_result',
          id: 'tool-1',
          content: '/tmp/file.txt:# heading',
          isError: false,
        },
      },
    ]);
  });

  it('ignores unsupported update shapes', () => {
    expect(normalizeCopilotAcpSessionUpdate({
      sessionId: 'session-1',
      update: {
        sessionUpdate: 'available_commands_update',
      },
    })).toEqual([]);
  });
});