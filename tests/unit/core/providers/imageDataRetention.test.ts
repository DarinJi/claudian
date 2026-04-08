import { shouldClearImageDataAfterSave } from '@/core/providers/imageDataRetention';

describe('imageDataRetention', () => {
  it('only clears image data after save for Claude sessions', () => {
    expect(shouldClearImageDataAfterSave('claude')).toBe(true);
    expect(shouldClearImageDataAfterSave('copilot')).toBe(false);
    expect(shouldClearImageDataAfterSave('codex')).toBe(false);
  });
});