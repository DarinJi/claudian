import { ProviderWorkspaceRegistry } from '../../../core/providers/ProviderWorkspaceRegistry';
import type {
  ProviderCliResolver,
  ProviderWorkspaceRegistration,
  ProviderWorkspaceServices,
} from '../../../core/providers/types';
import { CopilotCliResolver } from '../runtime/CopilotCliResolver';
import { copilotSettingsTabRenderer } from '../ui/CopilotSettingsTab';

export interface CopilotWorkspaceServices extends ProviderWorkspaceServices {
  cliResolver: ProviderCliResolver;
}

function createCopilotCliResolver(): ProviderCliResolver {
  return new CopilotCliResolver();
}

export async function createCopilotWorkspaceServices(): Promise<CopilotWorkspaceServices> {
  return {
    cliResolver: createCopilotCliResolver(),
    settingsTabRenderer: copilotSettingsTabRenderer,
  };
}

export const copilotWorkspaceRegistration: ProviderWorkspaceRegistration<CopilotWorkspaceServices> = {
  initialize: async () => createCopilotWorkspaceServices(),
};

export function maybeGetCopilotWorkspaceServices(): CopilotWorkspaceServices | null {
  return ProviderWorkspaceRegistry.getServices('copilot') as CopilotWorkspaceServices | null;
}

export function getCopilotWorkspaceServices(): CopilotWorkspaceServices {
  return ProviderWorkspaceRegistry.requireServices('copilot') as CopilotWorkspaceServices;
}