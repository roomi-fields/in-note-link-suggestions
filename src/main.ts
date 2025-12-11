/**
 * In-Note Link Suggestions Plugin
 *
 * Suggests where to insert internal links [[Note]] based on Smart Connections results.
 * Requires the Smart Connections plugin to be installed and enabled.
 */

import { Plugin, Notice, WorkspaceLeaf } from 'obsidian';
import { PluginSettings, DEFAULT_SETTINGS } from './types';
import { InNoteLinkSuggestionsView, VIEW_TYPE } from './view';
import { InNoteLinkSettingsTab } from './settings';

export default class InNoteLinkSuggestionsPlugin extends Plugin {
  settings: PluginSettings = DEFAULT_SETTINGS;

  async onload(): Promise<void> {
    await this.loadSettings();

    // Register the view
    this.registerView(VIEW_TYPE, (leaf) => new InNoteLinkSuggestionsView(leaf, this));

    // Add ribbon icon (using 'links' icon which shows two chain links)
    this.addRibbonIcon('link-2', 'In-Note Link Suggestions', () => {
      this.activateView();
    });

    // Add command to open view
    this.addCommand({
      id: 'open-in-note-link-suggestions',
      name: 'Open: In-note link suggestions',
      callback: () => {
        this.activateView();
      },
    });

    // Add command to refresh view
    this.addCommand({
      id: 'refresh-in-note-link-suggestions',
      name: 'Refresh: In-note link suggestions',
      callback: () => {
        const view = this.getView();
        if (view) {
          view.refresh();
        } else {
          this.activateView();
        }
      },
    });

    // Add settings tab
    this.addSettingTab(new InNoteLinkSettingsTab(this.app, this));

    // Check for Smart Connections on load
    this.app.workspace.onLayoutReady(() => {
      this.checkSmartConnections();
    });
  }

  onunload(): void {
    // Cleanup
  }

  /**
   * Load plugin settings
   */
  async loadSettings(): Promise<void> {
    this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
  }

  /**
   * Save plugin settings
   */
  async saveSettings(): Promise<void> {
    await this.saveData(this.settings);
  }

  /**
   * Check if Smart Connections is available
   */
  private checkSmartConnections(): void {
    const plugins = (this.app as any).plugins?.plugins;
    if (!plugins?.['smart-connections']) {
      new Notice(
        'In-Note Link Suggestions requires Smart Connections plugin. Please install and enable it.',
        10000
      );
    }
  }

  /**
   * Get the existing view instance
   */
  getView(): InNoteLinkSuggestionsView | null {
    const leaves = this.app.workspace.getLeavesOfType(VIEW_TYPE);
    if (leaves.length > 0) {
      return leaves[0].view as InNoteLinkSuggestionsView;
    }
    return null;
  }

  /**
   * Activate the view (open if not already open)
   */
  async activateView(): Promise<void> {
    console.log('[In-Note Links] Activating view...');
    const { workspace } = this.app;

    let leaf: WorkspaceLeaf | null = null;
    const leaves = workspace.getLeavesOfType(VIEW_TYPE);
    console.log('[In-Note Links] Existing leaves:', leaves.length);

    if (leaves.length > 0) {
      // View already exists, reveal it
      leaf = leaves[0];
      console.log('[In-Note Links] Using existing leaf');
    } else {
      // Create new leaf in right sidebar
      leaf = workspace.getRightLeaf(false);
      console.log('[In-Note Links] Created new leaf:', leaf);
      if (leaf) {
        await leaf.setViewState({ type: VIEW_TYPE, active: true });
        console.log('[In-Note Links] View state set');
      }
    }

    if (leaf) {
      workspace.revealLeaf(leaf);
      console.log('[In-Note Links] Leaf revealed');
    }
  }
}
