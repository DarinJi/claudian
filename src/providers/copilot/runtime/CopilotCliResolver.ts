import type { ProviderCliResolver } from '../../../core/providers/types';
import { getCopilotProviderSettings } from '../settings';

export class CopilotCliResolver implements ProviderCliResolver {
  resolveFromSettings(settings: Record<string, unknown>): string | null {
    const configured = getCopilotProviderSettings(settings).cliPath.trim();
    return configured || 'copilot';
  }

  reset(): void {
    // No cached resolution yet.
  }
}