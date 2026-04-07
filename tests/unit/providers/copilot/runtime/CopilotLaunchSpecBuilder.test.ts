import {
  buildCopilotAcpLaunchSpec,
  buildCopilotPromptLaunchSpec,
  parseCopilotExtraArgs,
} from '@/providers/copilot/runtime/CopilotLaunchSpecBuilder';

describe('CopilotLaunchSpecBuilder', () => {
  it('parses quoted extra args without losing whitespace', () => {
    expect(parseCopilotExtraArgs('--experimental --agent "vault helper" --flag value')).toEqual([
      '--experimental',
      '--agent',
      'vault helper',
      '--flag',
      'value',
    ]);
  });

  it('builds a prompt launch spec with safe-mode defaults', () => {
    const spec = buildCopilotPromptLaunchSpec({
      resolvedCliCommand: '/usr/local/bin/copilot',
      hostVaultPath: '/vault',
      env: { COPILOT_MODEL: 'claude-sonnet-4.5' },
      model: 'claude-sonnet-4.5',
      permissionMode: 'normal',
      addDirs: ['/external/context'],
      allowedTools: ['read_file', 'grep_search'],
      extraArgs: '--experimental',
      prompt: 'Summarize the open note',
    });

    expect(spec.command).toBe('/usr/local/bin/copilot');
    expect(spec.spawnCwd).toBe('/vault');
    expect(spec.args).toEqual([
      '--experimental',
      '--no-color',
      '--plain-diff',
      '--allow-all-tools',
      '--add-dir',
      '/vault',
      '--add-dir',
      '/external/context',
      '--available-tools',
      'read_file',
      'grep_search',
      '--model',
      'claude-sonnet-4.5',
      '--silent',
      '-p',
      'Summarize the open note',
    ]);
  });

  it('builds an ACP launch spec with yolo permissions', () => {
    const spec = buildCopilotAcpLaunchSpec({
      resolvedCliCommand: 'copilot',
      hostVaultPath: '/vault',
      env: {},
      model: 'claude-haiku-4.5',
      permissionMode: 'yolo',
      extraArgs: '',
    });

    expect(spec.args).toEqual([
      '--no-color',
      '--plain-diff',
      '--allow-all',
      '--add-dir',
      '/vault',
      '--model',
      'claude-haiku-4.5',
      '--acp',
    ]);
  });
});