import * as fs from 'fs';
import { Setting } from 'obsidian';

import type { ProviderSettingsTabRenderer } from '../../../core/providers/types';
import { renderEnvironmentSettingsSection } from '../../../features/settings/ui/EnvironmentSettingsSection';
import { getHostnameKey } from '../../../utils/env';
import { expandHomePath } from '../../../utils/path';
import { getCopilotWorkspaceServices } from '../app/CopilotWorkspaceServices';
import { getCopilotProviderSettings, updateCopilotProviderSettings } from '../settings';

export const copilotSettingsTabRenderer: ProviderSettingsTabRenderer = {
  render(container, context) {
    const workspace = getCopilotWorkspaceServices();
    const settingsBag = context.plugin.settings as unknown as Record<string, unknown>;
    const copilotSettings = getCopilotProviderSettings(settingsBag);
    const hostnameKey = getHostnameKey();
    const cliPathsByHost = { ...copilotSettings.cliPathsByHost };
    let cliPathInputEl: HTMLInputElement | null = null;

    new Setting(container).setName('Setup').setHeading();

    new Setting(container)
      .setName('Enable Copilot provider')
      .setDesc('When enabled, Copilot Claude models appear in the model selector for new conversations.')
      .addToggle((toggle) =>
        toggle
          .setValue(copilotSettings.enabled)
          .onChange(async (value) => {
            updateCopilotProviderSettings(settingsBag, { enabled: value });
            await context.plugin.saveSettings();
            context.refreshModelSelectors();
          })
      );

    const cliPathSetting = new Setting(container)
      .setName(`Copilot CLI path (${hostnameKey})`)
      .setDesc('Path to the Copilot CLI executable. Leave empty to use `copilot` from PATH.');

    const validationEl = container.createDiv({ cls: 'claudian-cli-path-validation' });
    validationEl.style.color = 'var(--text-error)';
    validationEl.style.fontSize = '0.85em';
    validationEl.style.marginTop = '-0.5em';
    validationEl.style.marginBottom = '0.5em';
    validationEl.style.display = 'none';

    const validatePath = (value: string): string | null => {
      const trimmed = value.trim();
      if (!trimmed) return null;

      const expandedPath = expandHomePath(trimmed);
      if (!fs.existsSync(expandedPath)) {
        return 'Configured path does not exist.';
      }
      const stat = fs.statSync(expandedPath);
      if (!stat.isFile()) {
        return 'Configured path points to a directory.';
      }
      return null;
    };

    const updateCliPathValidation = (value: string, inputEl?: HTMLInputElement): boolean => {
      const error = validatePath(value);
      if (error) {
        validationEl.setText(error);
        validationEl.style.display = 'block';
        if (inputEl) {
          inputEl.style.borderColor = 'var(--text-error)';
        }
        return false;
      }

      validationEl.style.display = 'none';
      if (inputEl) {
        inputEl.style.borderColor = '';
      }
      return true;
    };

    const currentCliPath = copilotSettings.cliPathsByHost[hostnameKey] || '';

    const persistCliPath = async (value: string): Promise<boolean> => {
      const isValid = updateCliPathValidation(value, cliPathInputEl ?? undefined);
      if (!isValid) {
        return false;
      }

      const trimmed = value.trim();
      if (trimmed) {
        cliPathsByHost[hostnameKey] = trimmed;
      } else {
        delete cliPathsByHost[hostnameKey];
      }

      updateCopilotProviderSettings(settingsBag, { cliPathsByHost: { ...cliPathsByHost } });
      await context.plugin.saveSettings();
      workspace.cliResolver.reset();
      const view = context.plugin.getView();
      await view?.getTabManager()?.broadcastToAllTabs(
        (service) => Promise.resolve(service.cleanup()),
      );
      return true;
    };

    cliPathSetting.addText((text) => {
      text
        .setPlaceholder('/usr/local/bin/copilot')
        .setValue(currentCliPath)
        .onChange(async (value) => {
          await persistCliPath(value);
        });
      text.inputEl.addClass('claudian-settings-cli-path-input');
      text.inputEl.style.width = '100%';
      cliPathInputEl = text.inputEl;
      updateCliPathValidation(currentCliPath, text.inputEl);
    });

    new Setting(container)
      .setName('Use ACP transport')
      .setDesc('Pre-warm and validate the Copilot ACP connection. Message execution still uses the prompt fallback until full ACP turn streaming lands.')
      .addToggle((toggle) =>
        toggle
          .setValue(copilotSettings.useACP)
          .onChange(async (value) => {
            updateCopilotProviderSettings(settingsBag, { useACP: value });
            await context.plugin.saveSettings();
          })
      );

    new Setting(container)
      .setName('Additional CLI arguments')
      .setDesc('Optional raw CLI arguments appended to Copilot CLI launches for both ACP preflight and prompt execution.')
      .addText((text) => {
        text
          .setPlaceholder('--experimental')
          .setValue(copilotSettings.extraArgs)
          .onChange(async (value) => {
            updateCopilotProviderSettings(settingsBag, { extraArgs: value.trim() });
            await context.plugin.saveSettings();
          });
        text.inputEl.addClass('claudian-settings-cli-path-input');
        text.inputEl.style.width = '100%';
      });

    renderEnvironmentSettingsSection({
      container,
      plugin: context.plugin,
      scope: 'provider:copilot',
      heading: 'Environment',
      name: 'Copilot environment variables',
      desc: 'Provider-specific environment variables passed to Copilot CLI. This is where BYOM and custom Claude routing will be configured.',
      placeholder: 'COPILOT_MODEL=claude-sonnet-4.6\nCOPILOT_PROVIDER_TYPE=anthropic\nCOPILOT_PROVIDER_API_KEY=your-key\nCOPILOT_PROVIDER_BASE_URL=https://api.anthropic.com',
      renderCustomContextLimits: (target) => context.renderCustomContextLimits(target, 'copilot'),
    });
  },
};