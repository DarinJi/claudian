import { getProviderConfig, setProviderConfig } from '../../core/providers/providerConfig';
import { getProviderEnvironmentVariables } from '../../core/providers/providerEnvironment';
import type { HostnameCliPaths } from '../../core/types/settings';
import { getHostnameKey } from '../../utils/env';

function normalizeHostnameCliPaths(value: unknown): HostnameCliPaths {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return {};
  }

  const result: HostnameCliPaths = {};
  for (const [key, entry] of Object.entries(value)) {
    if (typeof entry === 'string' && entry.trim()) {
      result[key] = entry.trim();
    }
  }
  return result;
}

function normalizeOptionalString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

export interface CopilotProviderSettings {
  enabled: boolean;
  cliPath: string;
  cliPathsByHost: HostnameCliPaths;
  useACP: boolean;
  extraArgs: string;
  environmentVariables: string;
  environmentHash: string;
}

export const DEFAULT_COPILOT_PROVIDER_SETTINGS: Readonly<CopilotProviderSettings> = Object.freeze({
  enabled: false,
  cliPath: '',
  cliPathsByHost: {},
  useACP: true,
  extraArgs: '',
  environmentVariables: '',
  environmentHash: '',
});

export function getCopilotProviderSettings(
  settings: Record<string, unknown>,
): CopilotProviderSettings {
  const config = getProviderConfig(settings, 'copilot');
  const hostnameKey = getHostnameKey();
  const cliPathsByHost = normalizeHostnameCliPaths(config.cliPathsByHost ?? settings.copilotCliPathsByHost);

  return {
    enabled: (config.enabled as boolean | undefined)
      ?? (settings.copilotEnabled as boolean | undefined)
      ?? DEFAULT_COPILOT_PROVIDER_SETTINGS.enabled,
    cliPath: cliPathsByHost[hostnameKey]
      ?? (config.cliPath as string | undefined)
      ?? (settings.copilotCliPath as string | undefined)
      ?? DEFAULT_COPILOT_PROVIDER_SETTINGS.cliPath,
    cliPathsByHost,
    useACP: (config.useACP as boolean | undefined)
      ?? (settings.copilotUseACP as boolean | undefined)
      ?? DEFAULT_COPILOT_PROVIDER_SETTINGS.useACP,
    extraArgs: normalizeOptionalString(config.extraArgs ?? settings.copilotExtraArgs)
      || DEFAULT_COPILOT_PROVIDER_SETTINGS.extraArgs,
    environmentVariables: (config.environmentVariables as string | undefined)
      ?? getProviderEnvironmentVariables(settings, 'copilot')
      ?? DEFAULT_COPILOT_PROVIDER_SETTINGS.environmentVariables,
    environmentHash: (config.environmentHash as string | undefined)
      ?? (settings.lastCopilotEnvHash as string | undefined)
      ?? DEFAULT_COPILOT_PROVIDER_SETTINGS.environmentHash,
  };
}

export function updateCopilotProviderSettings(
  settings: Record<string, unknown>,
  updates: Partial<CopilotProviderSettings>,
): CopilotProviderSettings {
  const next = {
    ...getCopilotProviderSettings(settings),
    ...updates,
  };
  setProviderConfig(settings, 'copilot', next);
  return next;
}