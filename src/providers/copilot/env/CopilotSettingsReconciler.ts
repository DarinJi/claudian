import { getRuntimeEnvironmentText } from '../../../core/providers/providerEnvironment';
import type { ProviderSettingsReconciler } from '../../../core/providers/types';
import type { Conversation } from '../../../core/types';
import { parseEnvironmentVariables } from '../../../utils/env';
import { getCopilotProviderSettings, updateCopilotProviderSettings } from '../settings';
import {
  buildCopilotModelValue,
  copilotChatUIConfig,
  DEFAULT_COPILOT_MODEL,
  isSupportedCopilotModel,
} from '../ui/CopilotChatUIConfig';

const ENV_HASH_KEYS = [
  'COPILOT_MODEL',
  'COPILOT_PROVIDER_TYPE',
  'COPILOT_PROVIDER_BASE_URL',
  'COPILOT_PROVIDER_API_KEY',
];

function computeCopilotEnvHash(envText: string): string {
  const envVars = parseEnvironmentVariables(envText || '');
  return ENV_HASH_KEYS
    .filter(key => envVars[key])
    .map(key => `${key}=${envVars[key]}`)
    .sort()
    .join('|');
}

export const copilotSettingsReconciler: ProviderSettingsReconciler = {
  reconcileModelWithEnvironment(
    settings: Record<string, unknown>,
    conversations: Conversation[],
  ): { changed: boolean; invalidatedConversations: Conversation[] } {
    const envText = getRuntimeEnvironmentText(settings, 'copilot');
    const currentHash = computeCopilotEnvHash(envText);
    const savedHash = getCopilotProviderSettings(settings).environmentHash;

    if (currentHash === savedHash) {
      return { changed: false, invalidatedConversations: [] };
    }

    const invalidatedConversations: Conversation[] = [];
    for (const conv of conversations) {
      if (conv.providerId === 'copilot' && conv.sessionId) {
        conv.sessionId = null;
        conv.providerState = undefined;
        invalidatedConversations.push(conv);
      }
    }

    const envVars = parseEnvironmentVariables(envText || '');
    if (envVars.COPILOT_MODEL && isSupportedCopilotModel(envVars.COPILOT_MODEL)) {
      settings.model = buildCopilotModelValue(envVars.COPILOT_MODEL);
    } else if (
      typeof settings.model === 'string'
      && settings.model.length > 0
      && !copilotChatUIConfig.isDefaultModel(settings.model)
      && copilotChatUIConfig.ownsModel(settings.model, settings)
    ) {
      settings.model = copilotChatUIConfig.getModelOptions(settings)[0]?.value ?? DEFAULT_COPILOT_MODEL;
    } else if (
      typeof settings.model === 'string'
      && copilotChatUIConfig.ownsModel(settings.model, settings)
      && !isSupportedCopilotModel(settings.model)
    ) {
      settings.model = DEFAULT_COPILOT_MODEL;
    }

    settings.effortLevel = 'high';

    updateCopilotProviderSettings(settings, { environmentHash: currentHash });
    return { changed: true, invalidatedConversations };
  },

  normalizeModelVariantSettings(settings: Record<string, unknown>): boolean {
    let changed = false;

    if (typeof settings.model === 'string') {
      const normalizedModel = copilotChatUIConfig.normalizeModelVariant(settings.model, settings);
      if (normalizedModel !== settings.model) {
        settings.model = normalizedModel;
        changed = true;
      }
    }

    if (settings.effortLevel !== 'high') {
      settings.effortLevel = 'high';
      changed = true;
    }

    const savedProviderModel = settings.savedProviderModel as Record<string, unknown> | undefined;
    if (
      savedProviderModel
      && Object.prototype.hasOwnProperty.call(savedProviderModel, 'copilot')
      && typeof savedProviderModel.copilot === 'string'
    ) {
      const normalizedSavedModel = copilotChatUIConfig.normalizeModelVariant(savedProviderModel.copilot, settings);
      if (normalizedSavedModel !== savedProviderModel.copilot) {
        savedProviderModel.copilot = normalizedSavedModel;
        changed = true;
      }
    }

    const savedProviderEffort = settings.savedProviderEffort as Record<string, unknown> | undefined;
    if (
      savedProviderEffort
      && Object.prototype.hasOwnProperty.call(savedProviderEffort, 'copilot')
      && savedProviderEffort.copilot !== 'high'
    ) {
      savedProviderEffort.copilot = 'high';
      changed = true;
    }

    return changed;
  },
};