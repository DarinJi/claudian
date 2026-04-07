import {
  resolveCopilotRuntimeModel,
  resolveDesiredCopilotSessionModel,
} from '@/providers/copilot/runtime/CopilotChatRuntime';

describe('CopilotChatRuntime', () => {
  it('resolves unsupported top-level models to the Copilot default model', () => {
    expect(resolveCopilotRuntimeModel(undefined, 'haiku')).toBe('claude-sonnet-4.6');
    expect(resolveCopilotRuntimeModel('haiku', 'copilot:claude-haiku-4.5')).toBe('claude-haiku-4.5');
    expect(resolveCopilotRuntimeModel('copilot:claude-opus-4.6', 'haiku')).toBe('claude-opus-4.6');
  });

  it('prefers the currently selected model over stale persisted session model config', () => {
    expect(resolveDesiredCopilotSessionModel('claude-haiku-4.5', 'claude-sonnet-4.6')).toBe('claude-haiku-4.5');
    expect(resolveDesiredCopilotSessionModel('claude-opus-4.6', null)).toBe('claude-opus-4.6');
  });
});