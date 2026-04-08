import * as fs from 'fs';
import * as path from 'path';

import type { McpServerConfig } from '../../../core/types';
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

function normalizeContextDirectory(rawPath: string): string | null {
  const trimmed = rawPath.trim();
  if (!trimmed || !path.isAbsolute(trimmed)) {
    return null;
  }

  try {
    const stat = fs.statSync(trimmed);
    if (stat.isDirectory()) {
      return trimmed;
    }
  } catch {
    // Fall through to best-effort dirname normalization.
  }

  return path.dirname(trimmed);
}

export function resolveCopilotContextAddDirs(
  hostVaultPath: string | null,
  externalContextPaths?: string[],
): string[] {
  const normalizedVaultPath = hostVaultPath?.trim() || null;
  const seen = new Set<string>();
  const resolved: string[] = [];

  for (const rawPath of externalContextPaths ?? []) {
    if (typeof rawPath !== 'string') {
      continue;
    }

    const normalizedDir = normalizeContextDirectory(rawPath);
    if (!normalizedDir) {
      continue;
    }

    if (normalizedVaultPath
      && (normalizedDir === normalizedVaultPath
        || normalizedDir.startsWith(normalizedVaultPath + path.sep))) {
      continue;
    }

    if (seen.has(normalizedDir)) {
      continue;
    }

    seen.add(normalizedDir);
    resolved.push(normalizedDir);
  }

  return resolved;
}

export function resolveCopilotAcpLaunchSpec(
  plugin: ClaudianPlugin,
  model: string,
  externalContextPaths?: string[],
  mcpServers?: Record<string, McpServerConfig>,
): CopilotLaunchSpec {
  const settingsBag = plugin.settings as unknown as Record<string, unknown>;
  const copilotSettings = getCopilotProviderSettings(settingsBag);
  const hostVaultPath = getCopilotWorkingDirectory(plugin);

  return buildCopilotAcpLaunchSpec({
    resolvedCliCommand: plugin.getResolvedProviderCliPath('copilot'),
    hostVaultPath,
    env: buildCopilotEnvironment(plugin),
    model,
    permissionMode: plugin.settings.permissionMode,
    addDirs: resolveCopilotContextAddDirs(hostVaultPath, externalContextPaths),
    mcpServers,
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
    mcpServers?: Record<string, McpServerConfig>;
  },
): CopilotLaunchSpec {
  const settingsBag = plugin.settings as unknown as Record<string, unknown>;
  const copilotSettings = getCopilotProviderSettings(settingsBag);
  const hostVaultPath = getCopilotWorkingDirectory(plugin);

  return buildCopilotPromptLaunchSpec({
    resolvedCliCommand: plugin.getResolvedProviderCliPath('copilot'),
    hostVaultPath,
    env: buildCopilotEnvironment(plugin),
    model: options.model,
    permissionMode: plugin.settings.permissionMode,
    addDirs: resolveCopilotContextAddDirs(hostVaultPath, options.externalContextPaths),
    allowedTools: options.allowedTools,
    mcpServers: options.mcpServers,
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