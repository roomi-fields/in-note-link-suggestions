/**
 * Settings tab for In-Note Link Suggestions plugin
 */

import { App, PluginSettingTab, Setting } from 'obsidian';
import type InNoteLinkSuggestionsPlugin from './main';
import { FolderSelectorModal } from './folder-selector-modal';

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

    // --- Matching Mode Section ---
    containerEl.createEl('h3', { text: 'Matching Mode' });

    new Setting(containerEl)
      .setName('Use frontmatter matching (recommended)')
      .setDesc('Find links based on article titles, focus keywords, and tags. More precise than semantic matching.')
      .addToggle(toggle => toggle
        .setValue(this.plugin.settings.enableFrontmatterMatch)
        .onChange(async (value) => {
          this.plugin.settings.enableFrontmatterMatch = value;
          // If enabling frontmatter, disable semantic
          if (value) {
            this.plugin.settings.enableSemanticMatch = false;
          }
          await this.plugin.saveSettings();
          this.display(); // Refresh to show/hide sections
        }));

    // Article folders with tree view selector
    const folderSetting = new Setting(containerEl)
      .setName('Article folders')
      .setDesc('Folders to scan for articles with frontmatter (title, focus_keyword, tags).')
      .addButton(button => button
        .setButtonText('Select folders')
        .onClick(() => {
          new FolderSelectorModal(
            this.app,
            this.plugin.settings.articleFolders,
            async (folders) => {
              this.plugin.settings.articleFolders = folders;
              await this.plugin.saveSettings();
              await this.plugin.reinitializeCache(); // Rebuild cache with new folders
              this.display(); // Refresh to show updated folders
            }
          ).open();
        }));

    // Display currently selected folders
    if (this.plugin.settings.articleFolders.length > 0) {
      const folderList = containerEl.createDiv({ cls: 'selected-folders-list' });
      for (const folder of this.plugin.settings.articleFolders) {
        const folderTag = folderList.createSpan({ cls: 'selected-folder-tag' });
        folderTag.createSpan({ text: '📁 ' + folder });
        const removeBtn = folderTag.createSpan({ cls: 'remove-folder-btn', text: ' ✕' });
        removeBtn.addEventListener('click', async () => {
          this.plugin.settings.articleFolders = this.plugin.settings.articleFolders.filter(f => f !== folder);
          await this.plugin.saveSettings();
          await this.plugin.reinitializeCache(); // Rebuild cache with new folders
          this.display();
        });
      }
    } else {
      containerEl.createDiv({
        cls: 'selected-folders-empty',
        text: 'No folders selected. Click "Select folders" to choose.',
      });
    }

    new Setting(containerEl)
      .setName('Minimum term length')
      .setDesc('Minimum characters for a term to be considered (avoids matching short words)')
      .addSlider(slider => slider
        .setLimits(3, 10, 1)
        .setValue(this.plugin.settings.minTermLength)
        .setDynamicTooltip()
        .onChange(async (value) => {
          this.plugin.settings.minTermLength = value;
          await this.plugin.saveSettings();
        }));

    // --- Semantic Matching Section (only show if frontmatter disabled) ---
    if (!this.plugin.settings.enableFrontmatterMatch) {
      containerEl.createEl('h3', { text: 'Semantic Matching (Legacy)' });

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
    }

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
    if (this.plugin.settings.enableFrontmatterMatch) {
      infoDiv.innerHTML = `
        <p><strong>Frontmatter mode (recommended)</strong></p>
        <p><strong>1.</strong> The plugin scans your article folders for frontmatter: <code>title</code>, <code>focus_keyword</code>, <code>tags</code>.</p>
        <p><strong>2.</strong> It searches for these terms in your current note.</p>
        <p><strong>3.</strong> When a match is found, it suggests a link to the corresponding article.</p>
        <p><em>Tip: Ensure your articles have proper frontmatter for best results.</em></p>
      `;
    } else {
      infoDiv.innerHTML = `
        <p><strong>Semantic mode (legacy)</strong></p>
        <p><strong>1. Smart Connections</strong> finds notes semantically related to your active note.</p>
        <p><strong>2. This plugin</strong> analyzes each sentence and compares it with candidate notes using AI embeddings.</p>
        <p><strong>3. Suggestions</strong> are shown when similarity exceeds the threshold.</p>
        <p><em>Tip: Adjust minimum similarity to control suggestion quantity.</em></p>
      `;
    }
  }
}
