import type { McpServerConfig } from '../../../core/types';
import type { CopilotLaunchSpec } from './copilotLaunchTypes';

export interface BuildCopilotLaunchSpecBaseOptions {
  resolvedCliCommand: string | null;
  hostVaultPath: string | null;
  env: Record<string, string>;
  model?: string;
  permissionMode?: string;
  addDirs?: string[];
  allowedTools?: string[];
  extraArgs?: string;
  mcpServers?: Record<string, McpServerConfig>;
}

export interface BuildCopilotPromptLaunchSpecOptions extends BuildCopilotLaunchSpecBaseOptions {
  prompt: string;
}

function normalizeAddDirs(addDirs: string[] | undefined, hostVaultPath: string | null): string[] {
  const entries = [hostVaultPath, ...(addDirs ?? [])]
    .filter((value): value is string => typeof value === 'string' && value.trim().length > 0)
    .map((value) => value.trim());

  const seen = new Set<string>();
  return entries.filter((value) => {
    if (seen.has(value)) {
      return false;
    }
    seen.add(value);
    return true;
  });
}

function buildPermissionArgs(permissionMode: string | undefined): string[] {
  if (permissionMode === 'yolo') {
    return ['--allow-all'];
  }

  return ['--allow-all-tools'];
}

function buildCommonArgs(options: BuildCopilotLaunchSpecBaseOptions): string[] {
  const args = [
    ...parseCopilotExtraArgs(options.extraArgs ?? ''),
    '--no-color',
    '--plain-diff',
    ...buildPermissionArgs(options.permissionMode),
  ];

  for (const dir of normalizeAddDirs(options.addDirs, options.hostVaultPath)) {
    args.push('--add-dir', dir);
  }

  if (options.allowedTools && options.allowedTools.length > 0) {
    args.push('--available-tools', ...options.allowedTools);
  }

  if (options.model) {
    args.push('--model', options.model);
  }

  if (options.mcpServers && Object.keys(options.mcpServers).length > 0) {
    args.push('--additional-mcp-config', JSON.stringify({ mcpServers: options.mcpServers }));
  }

  return args;
}

export function parseCopilotExtraArgs(input: string): string[] {
  const tokens: string[] = [];
  let current = '';
  let quote: 'single' | 'double' | null = null;
  let escaping = false;

  const pushCurrent = (): void => {
    if (!current) {
      return;
    }
    tokens.push(current);
    current = '';
  };

  for (const char of input) {
    if (escaping) {
      current += char;
      escaping = false;
      continue;
    }

    if (quote === 'single') {
      if (char === "'") {
        quote = null;
      } else {
        current += char;
      }
      continue;
    }

    if (quote === 'double') {
      if (char === '"') {
        quote = null;
      } else if (char === '\\') {
        escaping = true;
      } else {
        current += char;
      }
      continue;
    }

    if (/\s/.test(char)) {
      pushCurrent();
      continue;
    }

    if (char === "'") {
      quote = 'single';
      continue;
    }

    if (char === '"') {
      quote = 'double';
      continue;
    }

    if (char === '\\') {
      escaping = true;
      continue;
    }

    current += char;
  }

  if (escaping) {
    current += '\\';
  }

  pushCurrent();
  return tokens;
}

export function buildCopilotAcpLaunchSpec(
  options: BuildCopilotLaunchSpecBaseOptions,
): CopilotLaunchSpec {
  return {
    command: options.resolvedCliCommand?.trim() || 'copilot',
    args: [
      ...buildCommonArgs(options),
      '--acp',
    ],
    spawnCwd: options.hostVaultPath ?? process.cwd(),
    env: options.env,
  };
}

export function buildCopilotPromptLaunchSpec(
  options: BuildCopilotPromptLaunchSpecOptions,
): CopilotLaunchSpec {
  return {
    command: options.resolvedCliCommand?.trim() || 'copilot',
    args: [
      ...buildCommonArgs(options),
      '--silent',
      '-p',
      options.prompt,
    ],
    spawnCwd: options.hostVaultPath ?? process.cwd(),
    env: options.env,
  };
}