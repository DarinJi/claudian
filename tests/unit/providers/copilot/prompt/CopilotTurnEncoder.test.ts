import type { ChatTurnRequest } from '@/core/runtime/types';
import { encodeCopilotTurn } from '@/providers/copilot/prompt/CopilotTurnEncoder';

describe('encodeCopilotTurn', () => {
  it('returns a prepared turn with unchanged plain prompt when no context exists', () => {
    const request: ChatTurnRequest = { text: 'hello' };
    const result = encodeCopilotTurn(request);

    expect(result).toEqual({
      request,
      persistedContent: 'hello',
      prompt: 'hello',
      isCompact: false,
      mcpMentions: new Set(),
    });
  });

  it('appends current note context', () => {
    const result = encodeCopilotTurn({
      text: 'explain this',
      currentNotePath: 'notes/test.md',
    });

    expect(result.persistedContent).toContain('<current_note>');
    expect(result.persistedContent).toContain('notes/test.md');
  });

  it('appends editor selection context', () => {
    const result = encodeCopilotTurn({
      text: 'review this',
      editorSelection: {
        notePath: 'notes/code.md',
        mode: 'selection',
        selectedText: 'const answer = 42;',
      },
    });

    expect(result.persistedContent).toContain('<editor_selection');
    expect(result.persistedContent).toContain('const answer = 42;');
  });

  it('appends browser selection context', () => {
    const result = encodeCopilotTurn({
      text: 'summarize this',
      browserSelection: {
        source: 'surfing-view',
        url: 'https://example.com',
        selectedText: 'selected browser content',
      },
    });

    expect(result.persistedContent).toContain('<browser_selection');
    expect(result.persistedContent).toContain('selected browser content');
  });

  it('appends canvas selection context', () => {
    const result = encodeCopilotTurn({
      text: 'explain the diagram',
      canvasSelection: {
        canvasPath: 'boards/flow.canvas',
        nodeIds: ['node-a', 'node-b'],
      },
    });

    expect(result.persistedContent).toContain('<canvas_selection');
    expect(result.persistedContent).toContain('boards/flow.canvas');
    expect(result.persistedContent).toContain('node-a');
  });

  it('skips context encoding for compact turns', () => {
    const result = encodeCopilotTurn({
      text: '/compact',
      currentNotePath: 'notes/test.md',
      editorSelection: {
        notePath: 'notes/code.md',
        mode: 'selection',
        selectedText: 'const answer = 42;',
      },
    });

    expect(result.isCompact).toBe(true);
    expect(result.persistedContent).toBe('/compact');
    expect(result.prompt).toBe('/compact');
  });
});