import type { ProviderRegistration } from '../../core/providers/types';
import { CopilotInlineEditService } from './aux/CopilotInlineEditService';
import { CopilotInstructionRefineService } from './aux/CopilotInstructionRefineService';
import { CopilotTaskResultInterpreter } from './aux/CopilotTaskResultInterpreter';
import { CopilotTitleGenerationService } from './aux/CopilotTitleGenerationService';
import { COPILOT_PROVIDER_CAPABILITIES } from './capabilities';
import { copilotSettingsReconciler } from './env/CopilotSettingsReconciler';
import { CopilotConversationHistoryService } from './history/CopilotConversationHistoryService';
import { CopilotChatRuntime } from './runtime/CopilotChatRuntime';
import { getCopilotProviderSettings } from './settings';
import { copilotChatUIConfig } from './ui/CopilotChatUIConfig';

export const copilotProviderRegistration: ProviderRegistration = {
  displayName: 'Copilot',
  blankTabOrder: 30,
  isEnabled: (settings) => getCopilotProviderSettings(settings).enabled,
  capabilities: COPILOT_PROVIDER_CAPABILITIES,
  environmentKeyPatterns: [/^COPILOT_/i],
  chatUIConfig: copilotChatUIConfig,
  settingsReconciler: copilotSettingsReconciler,
  createRuntime: ({ plugin }) => new CopilotChatRuntime(plugin),
  createTitleGenerationService: (plugin) => new CopilotTitleGenerationService(),
  createInstructionRefineService: (_plugin) => new CopilotInstructionRefineService(),
  createInlineEditService: (_plugin) => new CopilotInlineEditService(),
  historyService: new CopilotConversationHistoryService(),
  taskResultInterpreter: new CopilotTaskResultInterpreter(),
};