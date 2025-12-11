/**
 * Settings tab for In-Note Link Suggestions plugin
 */

import { App, PluginSettingTab, Setting } from 'obsidian';
import type InNoteLinkSuggestionsPlugin from './main';

export class InNoteLinkSettingsTab extends PluginSettingTab {
  plugin: InNoteLinkSuggestionsPlugin;

  constructor(app: App, plugin: InNoteLinkSuggestionsPlugin) {
    super(app, plugin);
    this.plugin = plugin;
  }

  display(): void {
    const { containerEl } = this;
    containerEl.empty();

    containerEl.createEl('h2', { text: 'In-Note Link Suggestions' });

    // --- Semantic Matching Section ---
    containerEl.createEl('h3', { text: 'Semantic Matching' });

    new Setting(containerEl)
      .setName('Enable semantic matching')
      .setDesc('Use AI embeddings to find semantically related phrases. Requires Smart Connections.')
      .addToggle(toggle => toggle
        .setValue(this.plugin.settings.enableSemanticMatch)
        .onChange(async (value) => {
          this.plugin.settings.enableSemanticMatch = value;
          await this.plugin.saveSettings();
        }));

    new Setting(containerEl)
      .setName('Minimum similarity')
      .setDesc('Minimum similarity score (0.0-1.0). Higher = fewer but more precise suggestions. Recommended: 0.55-0.65')
      .addSlider(slider => slider
        .setLimits(0.3, 0.9, 0.05)
        .setValue(this.plugin.settings.minSemanticSimilarity)
        .setDynamicTooltip()
        .onChange(async (value) => {
          this.plugin.settings.minSemanticSimilarity = value;
          await this.plugin.saveSettings();
        }));

    // --- Limits Section ---
    containerEl.createEl('h3', { text: 'Limits' });

    new Setting(containerEl)
      .setName('Max suggestions per target note')
      .setDesc('Maximum number of phrases that can link to the same note. The top N by similarity are kept.')
      .addSlider(slider => slider
        .setLimits(1, 10, 1)
        .setValue(this.plugin.settings.maxSuggestionsPerNote)
        .setDynamicTooltip()
        .onChange(async (value) => {
          this.plugin.settings.maxSuggestionsPerNote = value;
          await this.plugin.saveSettings();
        }));

    new Setting(containerEl)
      .setName('Max total suggestions')
      .setDesc('Maximum total suggestions to display.')
      .addSlider(slider => slider
        .setLimits(5, 100, 5)
        .setValue(this.plugin.settings.maxTotalSuggestions)
        .setDynamicTooltip()
        .onChange(async (value) => {
          this.plugin.settings.maxTotalSuggestions = value;
          await this.plugin.saveSettings();
        }));

    new Setting(containerEl)
      .setName('Max candidate notes')
      .setDesc('Number of similar notes to consider from Smart Connections.')
      .addSlider(slider => slider
        .setLimits(10, 100, 5)
        .setValue(this.plugin.settings.maxCandidates)
        .setDynamicTooltip()
        .onChange(async (value) => {
          this.plugin.settings.maxCandidates = value;
          await this.plugin.saveSettings();
        }));

    // --- Info Section ---
    containerEl.createEl('h3', { text: 'How it works' });

    const infoDiv = containerEl.createDiv({ cls: 'setting-item-description' });
    infoDiv.innerHTML = `
      <p><strong>1. Smart Connections</strong> finds notes semantically related to your active note.</p>
      <p><strong>2. This plugin</strong> analyzes each sentence in your note and compares it with those candidate notes using AI embeddings.</p>
      <p><strong>3. Suggestions</strong> are shown when a sentence is similar enough to a candidate note (above the minimum similarity threshold).</p>
      <p><em>Tip: If you get too many suggestions, increase the minimum similarity. If you get too few, decrease it.</em></p>
    `;
  }
}
