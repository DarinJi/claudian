import { CopilotCommandCatalog } from '@/providers/copilot/commands/CopilotCommandCatalog';

describe('CopilotCommandCatalog', () => {
  it('exposes runtime commands in dropdown format', async () => {
    const catalog = new CopilotCommandCatalog();
    catalog.setRuntimeCommands([
      {
        id: 'copilot:sdk:compact',
        name: 'compact',
        description: 'Compact conversation history',
        content: '',
        source: 'sdk',
      },
    ]);

    await expect(catalog.listDropdownEntries({ includeBuiltIns: false })).resolves.toEqual([
      {
        id: 'copilot:sdk:compact',
        providerId: 'copilot',
        kind: 'command',
        name: 'compact',
        description: 'Compact conversation history',
        content: '',
        argumentHint: undefined,
        allowedTools: undefined,
        model: undefined,
        disableModelInvocation: undefined,
        userInvocable: undefined,
        context: undefined,
        agent: undefined,
        hooks: undefined,
        scope: 'runtime',
        source: 'sdk',
        isEditable: false,
        isDeletable: false,
        displayPrefix: '/',
        insertPrefix: '/',
      },
    ]);
  });

  it('does not allow editing runtime-only commands', async () => {
    const catalog = new CopilotCommandCatalog();

    await expect(catalog.saveVaultEntry({
      id: 'copilot:sdk:compact',
      providerId: 'copilot',
      kind: 'command',
      name: 'compact',
      content: '',
      scope: 'runtime',
      source: 'sdk',
      isEditable: false,
      isDeletable: false,
      displayPrefix: '/',
      insertPrefix: '/',
    })).rejects.toThrow('Copilot runtime commands are not editable.');
  });
});