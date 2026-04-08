import { McpServerManager } from '../../../core/mcp/McpServerManager';
import { McpStorage } from '../../../core/mcp/McpStorage';
import { ProviderWorkspaceRegistry } from '../../../core/providers/ProviderWorkspaceRegistry';
import type { ProviderCommandCatalog } from '../../../core/providers/commands/ProviderCommandCatalog';
import type {
  ProviderCliResolver,
  ProviderWorkspaceRegistration,
  ProviderWorkspaceServices,
} from '../../../core/providers/types';
import type { VaultFileAdapter } from '../../../core/storage/VaultFileAdapter';
import { CopilotCommandCatalog } from '../commands/CopilotCommandCatalog';
import { CopilotCliResolver } from '../runtime/CopilotCliResolver';
import { copilotSettingsTabRenderer } from '../ui/CopilotSettingsTab';

export interface CopilotWorkspaceServices extends ProviderWorkspaceServices {
  commandCatalog: ProviderCommandCatalog;
  cliResolver: ProviderCliResolver;
  mcpServerManager: McpServerManager;
}

function createCopilotCliResolver(): ProviderCliResolver {
  return new CopilotCliResolver();
}

export async function createCopilotWorkspaceServices(
  vaultAdapter: VaultFileAdapter,
): Promise<CopilotWorkspaceServices> {
  const mcpServerManager = new McpServerManager(new McpStorage(vaultAdapter));
  await mcpServerManager.loadServers();

  return {
    commandCatalog: new CopilotCommandCatalog(),
    cliResolver: createCopilotCliResolver(),
    mcpServerManager,
    settingsTabRenderer: copilotSettingsTabRenderer,
  };
}

export const copilotWorkspaceRegistration: ProviderWorkspaceRegistration<CopilotWorkspaceServices> = {
  initialize: async ({ vaultAdapter }) => createCopilotWorkspaceServices(vaultAdapter),
};

export function maybeGetCopilotWorkspaceServices(): CopilotWorkspaceServices | null {
  return ProviderWorkspaceRegistry.getServices('copilot') as CopilotWorkspaceServices | null;
}

export function getCopilotWorkspaceServices(): CopilotWorkspaceServices {
  return ProviderWorkspaceRegistry.requireServices('copilot') as CopilotWorkspaceServices;
}