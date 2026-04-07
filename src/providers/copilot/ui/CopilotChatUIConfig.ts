import type {
  ProviderChatUIConfig,
  ProviderPermissionModeToggleConfig,
  ProviderReasoningOption,
  ProviderUIOption,
} from '../../../core/providers/types';

interface CopilotModelOption extends ProviderUIOption {
  actualModel: string;
}

export const DEFAULT_COPILOT_MODEL = 'copilot:claude-sonnet-4.6';

const COPILOT_MODELS: CopilotModelOption[] = [
  {
    value: 'copilot:claude-sonnet-4.6',
    label: 'Claude Sonnet 4.6 · 1x',
    description: 'Balanced Claude model via Copilot. Usage multiplier: 1x.',
    actualModel: 'claude-sonnet-4.6',
  },
  {
    value: 'copilot:claude-haiku-4.5',
    label: 'Claude Haiku 4.5 · 0.33x',
    description: 'Fast Claude model via Copilot. Usage multiplier: 0.33x.',
    actualModel: 'claude-haiku-4.5',
  },
  {
    value: 'copilot:claude-opus-4.6',
    label: 'Claude Opus 4.6 · 3x',
    description: 'Highest quality Claude model via Copilot. Usage multiplier: 3x.',
    actualModel: 'claude-opus-4.6',
  },
];

const COPILOT_REASONING_OPTIONS: ProviderReasoningOption[] = [
  { value: 'high', label: 'High' },
];

const COPILOT_PERMISSION_MODE_TOGGLE: ProviderPermissionModeToggleConfig = {
  inactiveValue: 'normal',
  inactiveLabel: 'Safe',
  activeValue: 'yolo',
  activeLabel: 'YOLO',
  planValue: 'plan',
  planLabel: 'Plan',
};

const COPILOT_MODEL_SET = new Set(COPILOT_MODELS.map(model => model.value));

export function buildCopilotModelValue(actualModel: string): string {
  return actualModel.startsWith('copilot:') ? actualModel : `copilot:${actualModel}`;
}

export function resolveActualCopilotModel(model: string): string {
  return model.startsWith('copilot:') ? model.slice('copilot:'.length) : model;
}

export function isSupportedCopilotModel(model: string): boolean {
  return COPILOT_MODEL_SET.has(buildCopilotModelValue(model));
}

export const copilotChatUIConfig: ProviderChatUIConfig = {
  getModelOptions(_settings: Record<string, unknown>): ProviderUIOption[] {
    return [...COPILOT_MODELS];
  },

  ownsModel(model: string): boolean {
    return model.startsWith('copilot:');
  },

  isAdaptiveReasoningModel(): boolean {
    return true;
  },

  getReasoningOptions(): ProviderReasoningOption[] {
    return [...COPILOT_REASONING_OPTIONS];
  },

  getDefaultReasoningValue(): string {
    return 'high';
  },

  getContextWindowSize(): number {
    return 200_000;
  },

  isDefaultModel(model: string): boolean {
    return isSupportedCopilotModel(model);
  },

  applyModelDefaults(_model: string, settings: unknown): void {
    if (!settings || typeof settings !== 'object' || Array.isArray(settings)) {
      return;
    }

    (settings as Record<string, unknown>).effortLevel = 'high';
  },

  normalizeModelVariant(model: string): string {
    return isSupportedCopilotModel(model) ? buildCopilotModelValue(model) : DEFAULT_COPILOT_MODEL;
  },

  getCustomModelIds(_envVars: Record<string, string>): Set<string> {
    return new Set<string>();
  },

  getPermissionModeToggle(): ProviderPermissionModeToggleConfig {
    return COPILOT_PERMISSION_MODE_TOGGLE;
  },
};