import type { ProviderId } from '../../../core/providers/types';
import type ClaudianPlugin from '../../../main';
import { getEnhancedPath, parseEnvironmentVariables } from '../../../utils/env';
import { getVaultPath } from '../../../utils/path';
import { getCopilotProviderSettings } from '../settings';
import type { CopilotAcpInitializeResult } from './copilotAcpTypes';
import { buildCopilotAcpLaunchSpec, buildCopilotPromptLaunchSpec } from './CopilotLaunchSpecBuilder';
import type { CopilotLaunchSpec } from './copilotLaunchTypes';
import type { CopilotRpcTransport } from './CopilotRpcTransport';

const COPILOT_ACP_CLIENT_INFO = Object.freeze({
  name: 'claudian',
  version: '1.0.0',
});

export function getCopilotWorkingDirectory(plugin: ClaudianPlugin): string {
  return getVaultPath(plugin.app) ?? process.cwd();
}

export function buildCopilotEnvironment(
  plugin: ClaudianPlugin,
  providerId: ProviderId = 'copilot',
): Record<string, string> {
  const customEnv = parseEnvironmentVariables(plugin.getActiveEnvironmentVariables(providerId));
  const baseEnv = Object.fromEntries(
    Object.entries(process.env).filter((entry): entry is [string, string] => entry[1] !== undefined),
  );
  const resolvedCliPath = plugin.getResolvedProviderCliPath(providerId) ?? 'copilot';

  return {
    ...baseEnv,
    ...customEnv,
    PATH: getEnhancedPath(customEnv.PATH, resolvedCliPath),
  };
}

export function resolveCopilotAcpLaunchSpec(
  plugin: ClaudianPlugin,
  model: string,
): CopilotLaunchSpec {
  const settingsBag = plugin.settings as unknown as Record<string, unknown>;
  const copilotSettings = getCopilotProviderSettings(settingsBag);

  return buildCopilotAcpLaunchSpec({
    resolvedCliCommand: plugin.getResolvedProviderCliPath('copilot'),
    hostVaultPath: getCopilotWorkingDirectory(plugin),
    env: buildCopilotEnvironment(plugin),
    model,
    permissionMode: plugin.settings.permissionMode,
    extraArgs: copilotSettings.extraArgs,
  });
}

export function resolveCopilotPromptLaunchSpec(
  plugin: ClaudianPlugin,
  options: {
    prompt: string;
    model: string;
    allowedTools?: string[];
    externalContextPaths?: string[];
  },
): CopilotLaunchSpec {
  const settingsBag = plugin.settings as unknown as Record<string, unknown>;
  const copilotSettings = getCopilotProviderSettings(settingsBag);

  return buildCopilotPromptLaunchSpec({
    resolvedCliCommand: plugin.getResolvedProviderCliPath('copilot'),
    hostVaultPath: getCopilotWorkingDirectory(plugin),
    env: buildCopilotEnvironment(plugin),
    model: options.model,
    permissionMode: plugin.settings.permissionMode,
    addDirs: options.externalContextPaths,
    allowedTools: options.allowedTools,
    extraArgs: copilotSettings.extraArgs,
    prompt: options.prompt,
  });
}

export async function initializeCopilotAcpTransport(
  transport: CopilotRpcTransport,
): Promise<CopilotAcpInitializeResult> {
  const result = await transport.request<CopilotAcpInitializeResult>('initialize', {
    protocolVersion: 1,
    clientCapabilities: {
      fs: {
        readTextFile: true,
        writeTextFile: true,
      },
      terminal: true,
    },
    clientInfo: COPILOT_ACP_CLIENT_INFO,
  });

  transport.notify('initialized');
  return result;
}