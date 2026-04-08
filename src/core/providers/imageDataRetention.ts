import type { ProviderId } from './types';

export function shouldClearImageDataAfterSave(providerId: ProviderId): boolean {
  return providerId === 'claude';
}