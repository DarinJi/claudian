import {
  buildCopilotModelValue,
  copilotChatUIConfig,
  DEFAULT_COPILOT_MODEL,
  isSupportedCopilotModel,
  resolveActualCopilotModel,
} from '@/providers/copilot/ui/CopilotChatUIConfig';

describe('CopilotChatUIConfig', () => {
  describe('getModelOptions', () => {
    it('only exposes the three supported Claude models with usage multipliers', () => {
      const options = copilotChatUIConfig.getModelOptions({});

      expect(options.map(option => option.value)).toEqual([
        'copilot:claude-sonnet-4.6',
        'copilot:claude-haiku-4.5',
        'copilot:claude-opus-4.6',
      ]);
      expect(options.map(option => option.label)).toEqual([
        'Claude Sonnet 4.6 · 1x',
        'Claude Haiku 4.5 · 0.33x',
        'Claude Opus 4.6 · 3x',
      ]);
    });
  });

  describe('getReasoningOptions', () => {
    it('only exposes high effort because Copilot does not support live effort control', () => {
      expect(copilotChatUIConfig.getReasoningOptions('copilot:claude-sonnet-4.6')).toEqual([
        { value: 'high', label: 'High' },
      ]);
    });
  });

  describe('normalizeModelVariant', () => {
    it('normalizes unsupported Copilot models to the default Claude Sonnet 4.6 model', () => {
      expect(copilotChatUIConfig.normalizeModelVariant('copilot:claude-sonnet-4.5', {})).toBe(DEFAULT_COPILOT_MODEL);
      expect(copilotChatUIConfig.normalizeModelVariant('copilot:claude-opus-4.6', {})).toBe('copilot:claude-opus-4.6');
    });
  });

  describe('applyModelDefaults', () => {
    it('forces effort level to high', () => {
      const settings: Record<string, unknown> = { effortLevel: 'low' };

      copilotChatUIConfig.applyModelDefaults('copilot:claude-haiku-4.5', settings);

      expect(settings.effortLevel).toBe('high');
    });
  });

  describe('supported model helpers', () => {
    it('accepts only the allowed Copilot Claude models', () => {
      expect(isSupportedCopilotModel('claude-sonnet-4.6')).toBe(true);
      expect(isSupportedCopilotModel(buildCopilotModelValue('claude-opus-4.6'))).toBe(true);
      expect(isSupportedCopilotModel('claude-sonnet-4.5')).toBe(false);
      expect(resolveActualCopilotModel('copilot:claude-haiku-4.5')).toBe('claude-haiku-4.5');
    });
  });
});