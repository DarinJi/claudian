import {
  augmentCopilotPromptForImageAttachments,
  buildCopilotSessionImageMirrorPlan,
  extractCopilotSupportedCommands,
  resolveCopilotActiveMcpServers,
  resolveCopilotAcpSessionMcpServers,
  resolveCopilotPermissionOutcomeOptionId,
  resolveCopilotPermissionMode,
  resolveCopilotSessionModeId,
  resolveCopilotRuntimeModel,
  resolveCopilotSdkPermissionMode,
  resolveDesiredCopilotSessionModeId,
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

  it('normalizes Copilot ACP mode ids without downgrading unknown autopilot aliases to safe', () => {
    expect(resolveCopilotPermissionMode('https://agentclientprotocol.com/protocol/session-modes#autopilot')).toBe('yolo');
    expect(resolveCopilotPermissionMode('autopilot')).toBe('yolo');
    expect(resolveCopilotPermissionMode('https://agentclientprotocol.com/protocol/session-modes#plan')).toBe('plan');
    expect(resolveCopilotPermissionMode('https://agentclientprotocol.com/protocol/session-modes#agent')).toBe('normal');
    expect(resolveCopilotPermissionMode('unexpected-mode')).toBeNull();
  });

  it('maps Copilot ACP mode ids to the shared sync callback contract', () => {
    expect(resolveCopilotSdkPermissionMode('autopilot')).toBe('bypassPermissions');
    expect(resolveCopilotSdkPermissionMode('plan')).toBe('plan');
    expect(resolveCopilotSdkPermissionMode('agent')).toBe('default');
    expect(resolveCopilotSdkPermissionMode('unknown-mode')).toBeNull();
  });

  it('maps Claudian permission modes to Copilot ACP session modes', () => {
    expect(resolveCopilotSessionModeId('yolo')).toBe('https://agentclientprotocol.com/protocol/session-modes#autopilot');
    expect(resolveCopilotSessionModeId('plan')).toBe('https://agentclientprotocol.com/protocol/session-modes#plan');
    expect(resolveCopilotSessionModeId('normal')).toBe('https://agentclientprotocol.com/protocol/session-modes#agent');
    expect(resolveCopilotSessionModeId('unknown')).toBeNull();
  });

  it('preserves the requested permission mode over stale persisted session mode', () => {
    expect(resolveDesiredCopilotSessionModeId(
      'yolo',
      'https://agentclientprotocol.com/protocol/session-modes#agent',
    )).toBe('https://agentclientprotocol.com/protocol/session-modes#autopilot');

    expect(resolveDesiredCopilotSessionModeId(
      null,
      'https://agentclientprotocol.com/protocol/session-modes#plan',
    )).toBe('https://agentclientprotocol.com/protocol/session-modes#plan');
  });

  it('extracts provider commands from ACP available command updates', () => {
    expect(extractCopilotSupportedCommands({
      availableCommands: [
        'compact',
        {
          name: 'review',
          description: 'Review the current changes',
          argumentHint: '[scope]',
          kind: 'command',
        },
      ],
    })).toEqual([
      {
        id: 'copilot:sdk:compact:0',
        name: 'compact',
        content: '',
        source: 'sdk',
      },
      {
        id: 'copilot:sdk:review:1',
        name: 'review',
        description: 'Review the current changes',
        argumentHint: '[scope]',
        content: '',
        source: 'sdk',
        kind: 'command',
        allowedTools: undefined,
        model: undefined,
        disableModelInvocation: undefined,
        userInvocable: undefined,
      },
    ]);
  });

  it('combines MCP mentions with explicitly enabled MCP servers', () => {
    const extractMentions = jest.fn().mockReturnValue(new Set(['docs']));
    const getActiveServers = jest.fn().mockReturnValue({
      docs: { command: 'docs-server' },
      github: { command: 'github-server' },
    });

    expect(resolveCopilotActiveMcpServers(
      { extractMentions, getActiveServers },
      '@docs MCP review this diff',
      new Set(['github']),
    )).toEqual({
      docs: { command: 'docs-server' },
      github: { command: 'github-server' },
    });

    expect(getActiveServers).toHaveBeenCalledWith(new Set(['docs', 'github']));
  });

  it('maps ACP session MCP servers to a string array of enabled names', () => {
    expect(resolveCopilotAcpSessionMcpServers({
      docs: { command: 'docs-server' },
      github: { command: 'github-server' },
    })).toEqual(['docs', 'github']);

    expect(resolveCopilotAcpSessionMcpServers({})).toEqual([]);
    expect(resolveCopilotAcpSessionMcpServers(null)).toEqual([]);
  });

  it('adds an explicit image-analysis instruction when the user only attached images', () => {
    expect(augmentCopilotPromptForImageAttachments(
      '\n\n<current_note>\nnote.md\n</current_note>',
      '',
      true,
    )).toContain('The user attached one or more images.');

    expect(augmentCopilotPromptForImageAttachments(
      'Please summarize this screenshot.\n\n<current_note>\nnote.md\n</current_note>',
      'Please summarize this screenshot.',
      true,
    )).toBe('Please summarize this screenshot.\n\n<current_note>\nnote.md\n</current_note>');
  });

  it('maps Copilot ACP permission decisions to option ids', () => {
    const options = [
      { optionId: 'allow_once', kind: 'allow_once', name: 'Allow once' },
      { optionId: 'allow_always', kind: 'allow_always', name: 'Always allow' },
      { optionId: 'reject_once', kind: 'reject_once', name: 'Deny' },
    ];

    expect(resolveCopilotPermissionOutcomeOptionId('allow', options)).toBe('allow_once');
    expect(resolveCopilotPermissionOutcomeOptionId('allow-always', options)).toBe('allow_always');
    expect(resolveCopilotPermissionOutcomeOptionId('deny', options)).toBe('reject_once');
    expect(resolveCopilotPermissionOutcomeOptionId({ type: 'select-option', value: 'allow_always' }, options)).toBe('allow_always');
  });

  it('builds a session-state mirror plan for Copilot image attachments', () => {
    const plan = buildCopilotSessionImageMirrorPlan('session-123', [
      {
        id: 'img-1',
        name: '截图 1.png',
        mediaType: 'image/png',
        data: 'ZmFrZS1pbWFnZQ==',
        size: 10,
        source: 'paste',
      },
    ], '/Users/example');

    expect(plan).toHaveLength(1);
    expect(plan[0]?.filePath).toContain('.copilot/session-state/session-123/files/1-');
    expect(plan[0]?.filePath).toContain('.png');
    expect(plan[0]?.data.toString('base64')).toBe('ZmFrZS1pbWFnZQ==');
  });
});