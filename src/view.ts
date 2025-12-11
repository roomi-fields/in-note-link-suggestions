/**
 * In-Note Link Suggestions View
 */

import { ItemView, WorkspaceLeaf, TFile, MarkdownView, Notice } from 'obsidian';
import type InNoteLinkSuggestionsPlugin from './main';
import { LinkSuggestion, LinkCandidate } from './types';
import { computeLinkSuggestions } from './compute-suggestions';
import { computeSemanticSuggestions, SemanticMatchResult } from './semantic-matcher';

export const VIEW_TYPE = 'in-note-link-suggestions-view';

export class InNoteLinkSuggestionsView extends ItemView {
  plugin: InNoteLinkSuggestionsPlugin;
  private suggestions: LinkSuggestion[] = [];
  private appliedLinks: Set<string> = new Set();
  private currentFile: TFile | null = null;
  private refreshTimeout: NodeJS.Timeout | null = null;
  private lastRefreshFile: string | null = null;
  private lastEditorSelection: { text: string; start: number; end: number } | null = null;
  // Pagination state
  private currentOffset: number = 0;
  private hasMoreSuggestions: boolean = false;
  private totalAvailableSuggestions: number = 0;
  private cachedCandidates: LinkCandidate[] | null = null;
  private cachedNoteText: string | null = null;

  constructor(leaf: WorkspaceLeaf, plugin: InNoteLinkSuggestionsPlugin) {
    super(leaf);
    this.plugin = plugin;
  }

  getViewType(): string {
    return VIEW_TYPE;
  }

  getDisplayText(): string {
    return 'In-Note Link Suggestions';
  }

  getIcon(): string {
    return 'link';
  }

  async onOpen(): Promise<void> {
    this.registerEvent(
      this.app.workspace.on('active-leaf-change', () => {
        this.debouncedRefresh();
      })
    );
    this.registerEvent(
      this.app.workspace.on('file-open', () => {
        this.debouncedRefresh();
      })
    );

    // Track editor selection changes
    this.registerDomEvent(document, 'selectionchange', () => {
      this.captureEditorSelection();
    });

    // Show initial state immediately, then wait for SC in background
    this.showWaitingForSC();
    this.waitForSmartConnectionsAndRefresh();
  }

  /**
   * Capture current editor selection
   */
  private captureEditorSelection(): void {
    const activeView = this.app.workspace.getActiveViewOfType(MarkdownView);
    if (!activeView?.editor) return;

    const editor = activeView.editor;
    const selection = editor.getSelection();

    if (selection && selection.length > 0) {
      this.lastEditorSelection = {
        text: selection,
        start: editor.posToOffset(editor.getCursor('from')),
        end: editor.posToOffset(editor.getCursor('to')),
      };
    }
  }

  /**
   * Show waiting state
   */
  private showWaitingForSC(): void {
    const container = this.containerEl.children[1];
    container.empty();
    container.addClass('in-note-links-container');
    container.createDiv({
      cls: 'in-note-links-loading',
      text: 'Waiting for Smart Connections...',
    });
  }

  /**
   * Wait for Smart Connections in background, then refresh
   */
  private async waitForSmartConnectionsAndRefresh(): Promise<void> {
    const maxWaitMs = 60000;
    const checkIntervalMs = 1000;
    let waited = 0;

    while (waited < maxWaitMs) {
      const scPlugin = this.getSmartConnectionsPlugin();
      if (scPlugin?.env) {
        const env = scPlugin.env;
        const isLoaded = env.state === 'loaded' || env.collections_loaded;
        if (isLoaded && env.smart_sources) {
          console.log('[In-Note Links] Smart Connections is ready');
          await this.refresh(true);
          return;
        }
      }
      await new Promise(resolve => setTimeout(resolve, checkIntervalMs));
      waited += checkIntervalMs;
    }
    console.log('[In-Note Links] Timeout waiting for Smart Connections');
  }

  /**
   * Debounced refresh - only refresh if file actually changed
   */
  private debouncedRefresh(): void {
    // Clear any pending refresh
    if (this.refreshTimeout) {
      clearTimeout(this.refreshTimeout);
    }

    // Debounce: wait 200ms before refreshing
    this.refreshTimeout = setTimeout(() => {
      const activeFile = this.app.workspace.getActiveFile();
      const currentPath = activeFile?.path || null;

      // Only refresh if file actually changed
      if (currentPath !== this.lastRefreshFile) {
        this.refresh();
      }
    }, 200);
  }

  async onClose(): Promise<void> {
    // Cleanup
  }

  /**
   * Refresh the view with current file's suggestions
   */
  async refresh(force: boolean = false): Promise<void> {
    const activeFile = this.app.workspace.getActiveFile();
    const currentPath = activeFile?.path || null;

    // Skip if same file and not forced
    if (!force && currentPath === this.lastRefreshFile) {
      console.log('[In-Note Links] Skipping refresh, same file');
      return;
    }

    console.log('[In-Note Links] Refreshing view...');
    console.log('[In-Note Links] Active file:', activeFile?.path);

    // Update last refresh file
    this.lastRefreshFile = currentPath;

    if (activeFile !== this.currentFile) {
      this.appliedLinks.clear();
      this.currentFile = activeFile;
      // Reset pagination state
      this.currentOffset = 0;
      this.hasMoreSuggestions = false;
      this.totalAvailableSuggestions = 0;
      this.cachedCandidates = null;
      this.cachedNoteText = null;
    }

    const container = this.containerEl.children[1];
    container.empty();
    container.addClass('in-note-links-container');

    if (!activeFile) {
      this.renderEmptyState(container, 'Open a note to see link suggestions.');
      return;
    }

    if (activeFile.extension !== 'md') {
      this.renderEmptyState(container, 'Link suggestions only work with Markdown files.');
      return;
    }

    // Check if Smart Connections is available
    const scPlugin = this.getSmartConnectionsPlugin();
    if (!scPlugin) {
      this.renderEmptyState(
        container,
        'Smart Connections plugin is not installed or enabled. Please install it first.'
      );
      return;
    }

    // Render header
    this.renderHeader(container, activeFile);

    // Show loading
    const listContainer = container.createDiv({ cls: 'in-note-links-list' });
    listContainer.createDiv({
      cls: 'in-note-links-loading',
      text: 'Analyzing connections...',
    });

    try {
      // Get candidates from Smart Connections (cache for pagination)
      const candidates = await this.getCandidates(scPlugin, activeFile);
      this.cachedCandidates = candidates;

      if (!candidates || candidates.length === 0) {
        listContainer.empty();
        this.renderEmptyState(
          listContainer,
          'No connected notes found. Smart Connections needs to index your vault first.'
        );
        return;
      }

      // Read note content (cache for pagination)
      const noteText = await this.app.vault.read(activeFile);
      this.cachedNoteText = noteText;

      // Reset pagination on fresh refresh
      this.currentOffset = 0;

      // Compute suggestions
      console.log('[In-Note Links] Computing suggestions...');
      console.log('[In-Note Links] Semantic matching enabled:', this.plugin.settings.enableSemanticMatch);

      if (this.plugin.settings.enableSemanticMatch) {
        // Use fine-grained semantic matching (1-4 word n-grams)
        try {
          const result = await computeSemanticSuggestions(
            noteText,
            candidates,
            scPlugin.env,
            {
              minSimilarity: this.plugin.settings.minSemanticSimilarity,
              maxSuggestionsPerNote: this.plugin.settings.maxSuggestionsPerNote,
              maxTotalSuggestions: this.plugin.settings.maxTotalSuggestions,
              maxNGramWords: 4,
              offset: 0,
            }
          );
          this.suggestions = result.suggestions;
          this.hasMoreSuggestions = result.hasMore;
          this.totalAvailableSuggestions = result.totalAvailable;
        } catch (error) {
          console.error('[In-Note Links] Semantic matching failed, falling back to lexical:', error);
          // Fallback to lexical matching
          this.suggestions = computeLinkSuggestions(noteText, candidates, {
            maxSuggestionsPerNote: this.plugin.settings.maxSuggestionsPerNote,
            maxTotalSuggestions: this.plugin.settings.maxTotalSuggestions,
            enableFuzzyMatch: false,
          });
          this.hasMoreSuggestions = false;
          this.totalAvailableSuggestions = this.suggestions.length;
        }
      } else {
        // Use lexical matching only (title/alias exact match)
        this.suggestions = computeLinkSuggestions(noteText, candidates, {
          maxSuggestionsPerNote: this.plugin.settings.maxSuggestionsPerNote,
          maxTotalSuggestions: this.plugin.settings.maxTotalSuggestions,
          enableFuzzyMatch: false,
        });
        this.hasMoreSuggestions = false;
        this.totalAvailableSuggestions = this.suggestions.length;
      }

      console.log('[In-Note Links] Found suggestions:', this.suggestions.length, 'hasMore:', this.hasMoreSuggestions);

      listContainer.empty();

      if (this.suggestions.length === 0) {
        this.renderEmptyState(
          listContainer,
          "No link opportunities found. Connected notes aren't explicitly mentioned in this note's text."
        );
      } else {
        // Render suggestions
        this.renderSuggestions(listContainer, this.suggestions);
      }
    } catch (error) {
      console.error('Error computing link suggestions:', error);
      listContainer.empty();
      this.renderEmptyState(listContainer, `Error: ${(error as Error).message}`);
    } finally {
      // Always render footer exactly once
      this.renderFooter(container);
    }
  }

  /**
   * Get Smart Connections plugin instance
   */
  private getSmartConnectionsPlugin(): any {
    const plugins = (this.app as any).plugins?.plugins;
    console.log('[In-Note Links] Available plugins:', Object.keys(plugins || {}));
    const sc = plugins?.['smart-connections'];
    console.log('[In-Note Links] Smart Connections found:', !!sc);
    if (sc) {
      console.log('[In-Note Links] SC env:', !!sc.env);
      console.log('[In-Note Links] SC smart_sources:', !!sc.env?.smart_sources);
    }
    return sc;
  }

  /**
   * Get candidate notes from Smart Connections
   */
  private async getCandidates(
    scPlugin: any,
    activeFile: TFile
  ): Promise<LinkCandidate[]> {
    const env = scPlugin.env;
    if (!env?.smart_sources) {
      return [];
    }

    const sourceItem = env.smart_sources.get(activeFile.path);
    if (!sourceItem) {
      return [];
    }

    // Get or create connections list
    const connectionsList =
      sourceItem.connections ||
      env.connections_lists?.new_item(sourceItem);

    if (!connectionsList) {
      return [];
    }

    // Get results
    const results = await connectionsList.get_results({
      limit: this.plugin.settings.maxCandidates,
      results_collection_key: 'smart_sources',
    });

    if (!results || !Array.isArray(results)) {
      return [];
    }

    // Transform to candidates
    const candidates: LinkCandidate[] = [];
    for (const result of results) {
      const item = result.item;
      if (!item?.path) continue;

      // Get title from path
      const title = item.path.replace(/\.md$/, '').split('/').pop() || '';

      // Get aliases from metadata cache
      const file = this.app.vault.getAbstractFileByPath(item.path);
      let aliases: string[] = [];
      if (file instanceof TFile) {
        const cache = this.app.metadataCache.getFileCache(file);
        if (cache?.frontmatter?.aliases) {
          const rawAliases = cache.frontmatter.aliases;
          aliases = Array.isArray(rawAliases) ? rawAliases : [rawAliases];
        }
      }

      candidates.push({
        title,
        aliases,
        path: item.path,
        score: result.score,
      });
    }

    return candidates;
  }

  /**
   * Render header with note name
   */
  private renderHeader(container: Element, file: TFile): void {
    const header = container.createDiv({ cls: 'in-note-links-header' });
    header.createEl('h4', { text: 'Link Suggestions' });
    header.createEl('p', {
      cls: 'in-note-links-context',
      text: file.basename,
    });
  }

  /**
   * Render empty state message
   */
  private renderEmptyState(container: Element, message: string): void {
    const emptyDiv = container.createDiv({ cls: 'in-note-links-empty' });
    emptyDiv.createDiv({ cls: 'empty-icon', text: '🔗' });
    emptyDiv.createEl('p', { text: message });
  }

  /**
   * Render list of suggestions
   */
  private renderSuggestions(
    container: Element,
    suggestions: LinkSuggestion[]
  ): void {
    // Filter out ignored suggestions
    const filteredSuggestions = suggestions.filter(s => !this.isIgnored(s));

    if (filteredSuggestions.length === 0) {
      this.renderEmptyState(
        container,
        'No link opportunities found (some may be ignored).'
      );
      return;
    }

    for (const suggestion of filteredSuggestions) {
      const isApplied = this.isApplied(suggestion);

      const suggestionEl = container.createDiv({
        cls: `in-note-link-suggestion${isApplied ? ' applied' : ''}`,
      });

      // Target info
      const targetDiv = suggestionEl.createDiv({ cls: 'suggestion-target' });
      targetDiv.createSpan({
        cls: 'suggestion-target-title',
        text: suggestion.targetTitle,
      });

      // Context preview
      const contextDiv = suggestionEl.createDiv({ cls: 'suggestion-context' });
      this.renderContext(contextDiv, suggestion.context);

      // Actions
      const actionsDiv = suggestionEl.createDiv({ cls: 'suggestion-actions' });

      const insertBtn = actionsDiv.createEl('button', {
        cls: 'suggestion-btn-insert',
        text: isApplied ? 'Inserted' : 'Insert [[link]]',
      });
      if (isApplied) {
        insertBtn.disabled = true;
      }

      insertBtn.addEventListener('click', async () => {
        // Use last known editor selection if available
        const selection = this.lastEditorSelection;
        console.log('[In-Note Links] Insert clicked, lastEditorSelection:', selection);

        const success = await this.insertLink(suggestion, selection);
        console.log('[In-Note Links] Insert success:', success);

        // Clear selection after use
        this.lastEditorSelection = null;

        if (success) {
          console.log('[In-Note Links] Removing suggestion element');
          suggestionEl.remove();
        }
      });

      const viewBtn = actionsDiv.createEl('button', {
        cls: 'suggestion-btn-view',
        text: 'Show in note',
      });
      viewBtn.addEventListener('click', () => {
        console.log('[In-Note Links] Show in note clicked');
        this.scrollToSuggestion(suggestion);
      });

      const ignoreBtn = actionsDiv.createEl('button', {
        cls: 'suggestion-btn-ignore',
        text: 'Ignore',
      });
      ignoreBtn.addEventListener('click', async () => {
        await this.ignoreSuggestion(suggestion);
        suggestionEl.remove();
      });
    }
  }

  /**
   * Get the ignore key for a suggestion
   */
  private getIgnoreKey(suggestion: LinkSuggestion): string {
    return `${suggestion.targetPath}:${suggestion.matchedText}`;
  }

  /**
   * Check if a suggestion is ignored
   */
  private isIgnored(suggestion: LinkSuggestion): boolean {
    if (!this.currentFile) return false;
    const ignored = this.plugin.settings.ignoredSuggestions[this.currentFile.path] || [];
    return ignored.includes(this.getIgnoreKey(suggestion));
  }

  /**
   * Ignore a suggestion
   */
  private async ignoreSuggestion(suggestion: LinkSuggestion): Promise<void> {
    if (!this.currentFile) return;

    const filePath = this.currentFile.path;
    if (!this.plugin.settings.ignoredSuggestions[filePath]) {
      this.plugin.settings.ignoredSuggestions[filePath] = [];
    }

    const key = this.getIgnoreKey(suggestion);
    if (!this.plugin.settings.ignoredSuggestions[filePath].includes(key)) {
      this.plugin.settings.ignoredSuggestions[filePath].push(key);
      await this.plugin.saveSettings();
    }
  }

  /**
   * Clear ignored suggestions for current note
   */
  async clearIgnoredForCurrentNote(): Promise<void> {
    if (!this.currentFile) return;

    delete this.plugin.settings.ignoredSuggestions[this.currentFile.path];
    await this.plugin.saveSettings();
    await this.refresh(true);
  }

  /**
   * Load more suggestions (pagination)
   */
  private async loadMoreSuggestions(): Promise<void> {
    if (!this.hasMoreSuggestions) {
      new Notice('No more suggestions available at this similarity level');
      return;
    }

    if (!this.cachedCandidates || !this.cachedNoteText) {
      new Notice('Please refresh first');
      return;
    }

    const scPlugin = this.getSmartConnectionsPlugin();
    if (!scPlugin?.env) {
      new Notice('Smart Connections not available');
      return;
    }

    // Show loading state on button
    const moreBtn = this.containerEl.querySelector('.suggestion-btn-more') as HTMLButtonElement;
    const originalText = moreBtn?.textContent || '';
    if (moreBtn) {
      moreBtn.textContent = 'Loading...';
      moreBtn.disabled = true;
    }

    // Calculate new offset
    const newOffset = this.suggestions.length;
    console.log('[In-Note Links] Loading more suggestions, offset:', newOffset);

    try {
      const result = await computeSemanticSuggestions(
        this.cachedNoteText,
        this.cachedCandidates,
        scPlugin.env,
        {
          minSimilarity: this.plugin.settings.minSemanticSimilarity,
          maxSuggestionsPerNote: this.plugin.settings.maxSuggestionsPerNote,
          maxTotalSuggestions: 10, // Load 10 more
          maxNGramWords: 4,
          offset: newOffset,
        }
      );

      if (result.suggestions.length === 0) {
        new Notice('No more suggestions available at this similarity level');
        this.hasMoreSuggestions = false;
        // Re-render to update button state
        this.reRenderCurrentView();
        return;
      }

      // Add new suggestions to existing list
      this.suggestions = [...this.suggestions, ...result.suggestions];
      this.hasMoreSuggestions = result.hasMore;
      this.totalAvailableSuggestions = result.totalAvailable;

      console.log('[In-Note Links] Loaded more suggestions, total now:', this.suggestions.length);

      // Re-render the view
      this.reRenderCurrentView();

    } catch (error) {
      console.error('[In-Note Links] Error loading more suggestions:', error);
      new Notice('Error loading more suggestions');
      // Restore button state on error
      if (moreBtn) {
        moreBtn.textContent = originalText;
        moreBtn.disabled = false;
      }
    }
  }

  /**
   * Re-render the current view without full refresh
   */
  private reRenderCurrentView(): void {
    const container = this.containerEl.children[1];
    container.empty();
    container.addClass('in-note-links-container');

    if (!this.currentFile) return;

    // Render header
    this.renderHeader(container, this.currentFile);

    // Render suggestions list
    const listContainer = container.createDiv({ cls: 'in-note-links-list' });
    if (this.suggestions.length === 0) {
      this.renderEmptyState(
        listContainer,
        "No link opportunities found."
      );
    } else {
      this.renderSuggestions(listContainer, this.suggestions);
    }

    // Render footer
    this.renderFooter(container);
  }

  /**
   * Render context with highlighted match (truncated for display)
   */
  private renderContext(container: Element, context: string, maxLength: number = 80): void {
    // Context format: "...text before [matched text] text after..."
    const match = context.match(/^(.*?)\[(.*?)\](.*)$/);
    if (match) {
      let before = match[1];
      let matched = match[2];
      let after = match[3];

      // Truncate matched text if too long
      if (matched.length > maxLength) {
        matched = matched.substring(0, maxLength) + '...';
      }

      // Truncate before/after
      const sideLength = Math.floor((maxLength - matched.length) / 2);
      if (before.length > sideLength) {
        before = '...' + before.substring(before.length - sideLength);
      }
      if (after.length > sideLength) {
        after = after.substring(0, sideLength) + '...';
      }

      container.createSpan({ text: before });
      container.createSpan({ cls: 'match', text: matched });
      container.createSpan({ text: after });
    } else {
      // No match brackets, just truncate
      const truncated = context.length > maxLength
        ? context.substring(0, maxLength) + '...'
        : context;
      container.textContent = truncated;
    }
  }

  /**
   * Render footer with refresh button
   */
  private renderFooter(container: Element): void {
    const footer = container.createDiv({ cls: 'in-note-links-footer' });

    // Row 1: More suggestions button (only if semantic matching and there are more)
    if (this.plugin.settings.enableSemanticMatch) {
      const moreRow = footer.createDiv({ cls: 'footer-row' });
      const moreBtn = moreRow.createEl('button', {
        text: this.hasMoreSuggestions
          ? `More suggestions (${this.totalAvailableSuggestions - this.suggestions.length} available)`
          : 'More suggestions',
        cls: 'suggestion-btn-more',
      });

      if (!this.hasMoreSuggestions) {
        moreBtn.disabled = true;
      }

      moreBtn.addEventListener('click', () => {
        this.loadMoreSuggestions();
      });
    }

    // Row 2: Link removal buttons
    const removeRow = footer.createDiv({ cls: 'footer-row' });

    const removeAllBtn = removeRow.createEl('button', { text: 'Remove all links' });
    removeAllBtn.addEventListener('click', () => {
      this.removeAllLinks();
    });

    const removeSelBtn = removeRow.createEl('button', { text: 'Remove links in selection' });
    removeSelBtn.addEventListener('click', () => {
      this.removeLinksInSelection();
    });

    // Row 3: Refresh and reset
    const actionRow = footer.createDiv({ cls: 'footer-row' });

    const refreshBtn = actionRow.createEl('button', { text: 'Refresh' });
    refreshBtn.addEventListener('click', () => {
      this.appliedLinks.clear();
      this.refresh(true);
    });

    // Show reset ignored button (always visible, disabled if nothing to reset)
    const ignoredCount = this.currentFile
      ? (this.plugin.settings.ignoredSuggestions[this.currentFile.path]?.length || 0)
      : 0;

    const resetBtn = actionRow.createEl('button', {
      text: ignoredCount > 0 ? `Reset ignored (${ignoredCount})` : 'Reset ignored',
      cls: 'suggestion-btn-reset',
    });

    if (ignoredCount === 0) {
      resetBtn.disabled = true;
    }

    resetBtn.addEventListener('click', async () => {
      await this.clearIgnoredForCurrentNote();
    });
  }

  /**
   * Remove links from text, preserving images and returning cleaned text
   */
  private removeLinksFromText(text: string): string {
    // Replace wiki-links [[Note]] or [[Note|display]] with display text
    // But NOT image embeds ![[...]]
    let result = text;

    // Wiki-links with display text: [[target|display]] → display
    // Negative lookbehind for ! to avoid matching image embeds
    result = result.replace(/(?<!!)\[\[([^\]|]+)\|([^\]]+)\]\]/g, '$2');

    // Wiki-links without display text: [[target]] → target
    result = result.replace(/(?<!!)\[\[([^\]]+)\]\]/g, '$1');

    // Markdown links: [display](url) → display
    // But NOT image embeds ![alt](url)
    result = result.replace(/(?<!!)\[([^\]]+)\]\([^)]+\)/g, '$1');

    return result;
  }

  /**
   * Get frontmatter end position (after closing ---)
   */
  private getFrontmatterEnd(text: string): number {
    if (!text.startsWith('---')) return 0;
    const endMatch = text.indexOf('\n---', 3);
    if (endMatch === -1) return 0;
    return endMatch + 4; // Include the \n---
  }

  /**
   * Remove all links in the current note (except images and frontmatter)
   */
  private async removeAllLinks(): Promise<void> {
    if (!this.currentFile) return;

    const leaves = this.app.workspace.getLeavesOfType('markdown');
    const targetLeaf = leaves.find(leaf => {
      const view = leaf.view as MarkdownView;
      return view.file?.path === this.currentFile?.path;
    });

    if (!targetLeaf) return;

    const editor = (targetLeaf.view as MarkdownView).editor;
    if (!editor) return;

    const content = editor.getValue();
    const frontmatterEnd = this.getFrontmatterEnd(content);

    // Split content: frontmatter (untouched) + body (process)
    const frontmatter = content.substring(0, frontmatterEnd);
    const body = content.substring(frontmatterEnd);

    // Remove links from body only
    const cleanedBody = this.removeLinksFromText(body);

    // Reconstruct
    const newContent = frontmatter + cleanedBody;

    if (newContent !== content) {
      editor.setValue(newContent);
      console.log('[In-Note Links] Removed all links from note');
    }
  }

  /**
   * Remove links in current selection (except images)
   */
  private removeLinksInSelection(): void {
    if (!this.currentFile) return;

    const leaves = this.app.workspace.getLeavesOfType('markdown');
    const targetLeaf = leaves.find(leaf => {
      const view = leaf.view as MarkdownView;
      return view.file?.path === this.currentFile?.path;
    });

    if (!targetLeaf) return;

    const editor = (targetLeaf.view as MarkdownView).editor;
    if (!editor) return;

    const selection = editor.getSelection();
    if (!selection || selection.length === 0) {
      console.log('[In-Note Links] No selection');
      return;
    }

    // Remove links from selection
    const cleaned = this.removeLinksFromText(selection);

    if (cleaned !== selection) {
      editor.replaceSelection(cleaned);
      console.log('[In-Note Links] Removed links from selection');
    }
  }

  /**
   * Check if a suggestion has been applied
   */
  private isApplied(suggestion: LinkSuggestion): boolean {
    return this.appliedLinks.has(
      `${suggestion.targetPath}:${suggestion.globalStart}`
    );
  }

  /**
   * Insert a wiki-link at the suggestion position or at selection
   * If capturedSelection is provided, use that instead of the suggested text
   */
  async insertLink(
    suggestion: LinkSuggestion,
    capturedSelection?: { text: string; start: number; end: number } | null
  ): Promise<boolean> {
    console.log('[In-Note Links] insertLink called with selection:', capturedSelection);

    if (!this.currentFile) return false;

    // Find the editor for our file (not the active view which might be the panel)
    const leaves = this.app.workspace.getLeavesOfType('markdown');
    const targetLeaf = leaves.find(leaf => {
      const view = leaf.view as MarkdownView;
      return view.file?.path === this.currentFile?.path;
    });

    const editor = targetLeaf ? (targetLeaf.view as MarkdownView).editor : null;
    console.log('[In-Note Links] Editor found:', !!editor);

    let insertedAt: { start: number; oldLength: number; newLength: number } | null = null;

    if (!editor) {
      // Fallback without editor - use suggested position
      try {
        const content = await this.app.vault.read(this.currentFile);
        const matchedText = suggestion.matchedText;
        const isExactTitle = matchedText.toLowerCase() === suggestion.targetTitle.toLowerCase();
        const linkText = isExactTitle
          ? `[[${suggestion.targetTitle}]]`
          : `[[${suggestion.targetTitle}|${matchedText}]]`;

        const before = content.substring(0, suggestion.globalStart);
        const after = content.substring(suggestion.globalEnd);
        const newContent = before + linkText + after;
        await this.app.vault.modify(this.currentFile, newContent);

        insertedAt = {
          start: suggestion.globalStart,
          oldLength: suggestion.globalEnd - suggestion.globalStart,
          newLength: linkText.length,
        };
      } catch (e) {
        console.error('Failed to insert link:', e);
        return false;
      }
    } else {
      // Check if there's a captured selection
      if (capturedSelection && capturedSelection.text.length > 0) {
        // Use captured selection text
        const isExactTitle = capturedSelection.text.toLowerCase() === suggestion.targetTitle.toLowerCase();
        const linkText = isExactTitle
          ? `[[${suggestion.targetTitle}]]`
          : `[[${suggestion.targetTitle}|${capturedSelection.text}]]`;

        const startPos = editor.offsetToPos(capturedSelection.start);
        const endPos = editor.offsetToPos(capturedSelection.end);
        editor.replaceRange(linkText, startPos, endPos);

        insertedAt = {
          start: capturedSelection.start,
          oldLength: capturedSelection.end - capturedSelection.start,
          newLength: linkText.length,
        };
      } else {
        // No selection - use suggested position
        const matchedText = suggestion.matchedText;
        const isExactTitle = matchedText.toLowerCase() === suggestion.targetTitle.toLowerCase();
        const linkText = isExactTitle
          ? `[[${suggestion.targetTitle}]]`
          : `[[${suggestion.targetTitle}|${matchedText}]]`;

        const startPos = editor.offsetToPos(suggestion.globalStart);
        const endPos = editor.offsetToPos(suggestion.globalEnd);
        editor.replaceRange(linkText, startPos, endPos);

        insertedAt = {
          start: suggestion.globalStart,
          oldLength: suggestion.globalEnd - suggestion.globalStart,
          newLength: linkText.length,
        };
      }
    }

    // Adjust positions of remaining suggestions
    if (insertedAt) {
      this.adjustSuggestionPositions(insertedAt);
    }

    // Add to ignored so it won't show again
    await this.ignoreSuggestion(suggestion);

    return true;
  }

  /**
   * Adjust positions of remaining suggestions after an insertion
   */
  private adjustSuggestionPositions(inserted: { start: number; oldLength: number; newLength: number }): void {
    const delta = inserted.newLength - inserted.oldLength;

    for (const suggestion of this.suggestions) {
      // Only adjust suggestions that come after the insertion point
      if (suggestion.globalStart > inserted.start) {
        suggestion.globalStart += delta;
        suggestion.globalEnd += delta;
      }
    }
  }

  /**
   * Scroll editor to show the suggestion with surrounding context
   */
  scrollToSuggestion(suggestion: LinkSuggestion): void {
    console.log('[In-Note Links] scrollToSuggestion', {
      globalStart: suggestion.globalStart,
      globalEnd: suggestion.globalEnd,
      currentFile: this.currentFile?.path
    });

    // Use currentFile instead of activeFile (which might be the panel)
    if (!this.currentFile) {
      console.log('[In-Note Links] No currentFile');
      return;
    }

    // Find the leaf that has our file open
    const leaves = this.app.workspace.getLeavesOfType('markdown');
    console.log('[In-Note Links] Found', leaves.length, 'markdown leaves');

    const targetLeaf = leaves.find(leaf => {
      const view = leaf.view as MarkdownView;
      return view.file?.path === this.currentFile?.path;
    });

    if (!targetLeaf) {
      console.log('[In-Note Links] No targetLeaf found');
      return;
    }

    // Get the editor from the view
    const view = targetLeaf.view as MarkdownView;
    const editor = view.editor;
    if (!editor) {
      console.log('[In-Note Links] No editor');
      return;
    }

    // Calculate positions
    const pos = editor.offsetToPos(suggestion.globalStart);
    const endPos = editor.offsetToPos(suggestion.globalEnd);
    console.log('[In-Note Links] Positions:', pos, endPos);

    // Find paragraph boundaries
    const lineCount = editor.lineCount();
    let paragraphStart = pos.line;
    let paragraphEnd = endPos.line;

    while (paragraphStart > 0 && editor.getLine(paragraphStart - 1).trim() !== '') {
      paragraphStart--;
    }
    while (paragraphEnd < lineCount - 1 && editor.getLine(paragraphEnd + 1).trim() !== '') {
      paragraphEnd++;
    }

    // Add 2 lines of context
    const contextStart = Math.max(0, paragraphStart - 2);
    const contextEnd = Math.min(lineCount - 1, paragraphEnd + 2);
    console.log('[In-Note Links] Context lines:', contextStart, '-', contextEnd);

    // Focus the leaf
    this.app.workspace.setActiveLeaf(targetLeaf, { focus: true });

    // Scroll to show the paragraph with context
    setTimeout(() => {
      console.log('[In-Note Links] Executing scroll...');

      try {
        // First, scroll to show the context (paragraph + 2 lines)
        // Set cursor to context start to trigger scroll there
        editor.setCursor({ line: contextStart, ch: 0 });

        // Now scroll to ensure the whole context is visible
        // We use scrollIntoView on the range from contextStart to contextEnd
        editor.scrollIntoView({
          from: { line: contextStart, ch: 0 },
          to: { line: contextEnd, ch: editor.getLine(contextEnd).length }
        }, true);

        // Small delay then set the actual selection (without scrolling again)
        setTimeout(() => {
          editor.setSelection(pos, endPos);
          editor.focus();
        }, 50);

      } catch (e) {
        console.error('[In-Note Links] Scroll error:', e);
      }

      console.log('[In-Note Links] Scroll done');
    }, 150);
  }
}
