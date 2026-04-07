import type { ChatMessage, ForkSource } from '../../core/types';

export interface CopilotProviderState {
  persistedMessages?: ChatMessage[];
  forkSource?: ForkSource;
  currentModeId?: string;
  currentModelId?: string;
  configValues?: Record<string, string>;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function getCopilotState(providerState: unknown): CopilotProviderState {
  if (!isRecord(providerState)) {
    return {};
  }

  const state: CopilotProviderState = {};
  if (Array.isArray(providerState.persistedMessages)) {
    state.persistedMessages = providerState.persistedMessages as ChatMessage[];
  }
  if (
    isRecord(providerState.forkSource)
    && typeof providerState.forkSource.sessionId === 'string'
    && typeof providerState.forkSource.resumeAt === 'string'
  ) {
    state.forkSource = {
      sessionId: providerState.forkSource.sessionId,
      resumeAt: providerState.forkSource.resumeAt,
    };
  }
  if (typeof providerState.currentModeId === 'string') {
    state.currentModeId = providerState.currentModeId;
  }
  if (typeof providerState.currentModelId === 'string') {
    state.currentModelId = providerState.currentModelId;
  }
  if (isRecord(providerState.configValues)) {
    state.configValues = Object.fromEntries(
      Object.entries(providerState.configValues)
        .filter(([, value]) => typeof value === 'string'),
    ) as Record<string, string>;
  }

  return state;
}