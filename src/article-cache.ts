/**
 * Article cache for fast frontmatter-based link suggestions
 *
 * Maintains an in-memory cache of article content and frontmatter,
 * with incremental updates on file changes.
 */

import { App, TFile, TFolder, EventRef } from 'obsidian';
import { ConceptEntry } from './frontmatter-matcher';

export interface CachedArticle {
  path: string;
  title: string;
  content: string;  // Full text content for backlink searching
  frontmatter: {
    title?: string;
    focus_keyword?: string;
    tags?: string[];
  };
  /** Terms extracted from this article's frontmatter */
  terms: ConceptEntry[];
  lastModified: number;
}

export class ArticleCache {
  private app: App;
  private cache: Map<string, CachedArticle> = new Map();
  private articleFolders: string[] = [];
  private eventRefs: EventRef[] = [];
  private isBuilding: boolean = false;
  private lastBuildTime: number = 0;
  private onUpdateCallbacks: Array<() => void> = [];

  constructor(app: App) {
    this.app = app;
  }

  /**
   * Initialize cache and register file watchers
   */
  async initialize(articleFolders: string[]): Promise<void> {
    this.articleFolders = articleFolders;

    // Build initial cache
    await this.buildCache();

    // Register file event listeners
    this.registerEventListeners();
  }

  /**
   * Update article folders and rebuild cache
   */
  async updateFolders(articleFolders: string[]): Promise<void> {
    this.articleFolders = articleFolders;
    await this.buildCache();
  }

  /**
   * Register callback to be called when cache updates
   */
  onUpdate(callback: () => void): void {
    this.onUpdateCallbacks.push(callback);
  }

  /**
   * Unregister all event listeners
   */
  destroy(): void {
    for (const ref of this.eventRefs) {
      this.app.vault.offref(ref);
    }
    this.eventRefs = [];
    this.onUpdateCallbacks = [];
  }

  /**
   * Get all cached articles
   */
  getArticles(): CachedArticle[] {
    return Array.from(this.cache.values());
  }

  /**
   * Get all concept entries (for outgoing link suggestions)
   */
  getConceptIndex(): ConceptEntry[] {
    const entries: ConceptEntry[] = [];
    for (const article of this.cache.values()) {
      entries.push(...article.terms);
    }
    return entries;
  }

  /**
   * Get cache statistics
   */
  getStats(): { articleCount: number; termCount: number; lastBuildTime: number } {
    let termCount = 0;
    for (const article of this.cache.values()) {
      termCount += article.terms.length;
    }
    return {
      articleCount: this.cache.size,
      termCount,
      lastBuildTime: this.lastBuildTime,
    };
  }

  /**
   * Build the entire cache from scratch
   */
  private async buildCache(): Promise<void> {
    if (this.isBuilding) return;
    this.isBuilding = true;

    console.log('[ArticleCache] Building cache for folders:', this.articleFolders);
    const startTime = Date.now();

    this.cache.clear();

    for (const folderPath of this.articleFolders) {
      const folder = this.app.vault.getAbstractFileByPath(folderPath);
      if (folder instanceof TFolder) {
        await this.scanFolder(folder);
      }
    }

    this.lastBuildTime = Date.now();
    const elapsed = this.lastBuildTime - startTime;
    console.log(`[ArticleCache] Cache built: ${this.cache.size} articles, ${elapsed}ms`);

    this.isBuilding = false;
    this.notifyUpdate();
  }

  /**
   * Recursively scan a folder for articles
   */
  private async scanFolder(folder: TFolder): Promise<void> {
    for (const child of folder.children) {
      if (child instanceof TFolder) {
        // Skip hidden folders
        if (child.name.startsWith('.') || child.name.startsWith('_')) continue;
        await this.scanFolder(child);
      } else if (child instanceof TFile && child.extension === 'md') {
        await this.cacheArticle(child);
      }
    }
  }

  /**
   * Cache a single article
   */
  private async cacheArticle(file: TFile): Promise<void> {
    // Only index preprint or final articles, or standalone articles
    if (!this.shouldIndexFile(file)) return;

    try {
      const content = await this.app.vault.cachedRead(file);
      const cache = this.app.metadataCache.getFileCache(file);
      const fm = cache?.frontmatter || {};

      const article: CachedArticle = {
        path: file.path,
        title: fm.title || file.basename,
        content,
        frontmatter: {
          title: fm.title,
          focus_keyword: fm.focus_keyword,
          tags: Array.isArray(fm.tags) ? fm.tags : fm.tags ? [fm.tags] : [],
        },
        terms: this.extractTerms(file.path, fm),
        lastModified: file.stat.mtime,
      };

      this.cache.set(file.path, article);
    } catch (error) {
      console.error(`[ArticleCache] Error caching ${file.path}:`, error);
    }
  }

  /**
   * Check if a file should be indexed
   */
  private shouldIndexFile(file: TFile): boolean {
    // Check if in article folders
    const inArticleFolder = this.articleFolders.some(folder =>
      file.path.startsWith(folder + '/')
    );
    if (!inArticleFolder) return false;

    // Only index preprint or final articles
    if (file.name.includes('_6_preprint') || file.name.includes('_published')) {
      return true;
    }

    // Check if it's a standalone article (no pipeline suffix)
    const hasPipelineSuffix = /_\d_\w+\.md$/.test(file.name);
    return !hasPipelineSuffix;
  }

  /**
   * Extract searchable terms from frontmatter
   */
  private extractTerms(targetPath: string, fm: any): ConceptEntry[] {
    const terms: ConceptEntry[] = [];
    const targetTitle = fm.title || targetPath.split('/').pop()?.replace('.md', '') || '';
    const seenTerms = new Set<string>();

    // Add title
    if (fm.title && typeof fm.title === 'string' && fm.title.length >= 3) {
      const key = fm.title.toLowerCase().trim();
      if (!seenTerms.has(key)) {
        seenTerms.add(key);
        terms.push({
          term: fm.title.trim(),
          targetPath,
          targetTitle,
          source: 'title',
        });
      }
    }

    // Add focus_keyword
    if (fm.focus_keyword && typeof fm.focus_keyword === 'string' && fm.focus_keyword.length >= 3) {
      const key = fm.focus_keyword.toLowerCase().trim();
      if (!seenTerms.has(key)) {
        seenTerms.add(key);
        terms.push({
          term: fm.focus_keyword.trim(),
          targetPath,
          targetTitle,
          source: 'focus_keyword',
        });
      }
    }

    // Add tags
    const tags = Array.isArray(fm.tags) ? fm.tags : fm.tags ? [fm.tags] : [];
    for (const tag of tags) {
      if (typeof tag === 'string' && tag.length >= 3) {
        const key = tag.toLowerCase().trim();
        if (!seenTerms.has(key)) {
          seenTerms.add(key);
          terms.push({
            term: tag.trim(),
            targetPath,
            targetTitle,
            source: 'tag',
          });
        }
      }
    }

    return terms;
  }

  /**
   * Register event listeners for file changes
   */
  private registerEventListeners(): void {
    // File modified
    const modifyRef = this.app.vault.on('modify', async (file) => {
      if (file instanceof TFile && file.extension === 'md') {
        if (this.isInArticleFolders(file.path)) {
          console.log(`[ArticleCache] File modified: ${file.path}`);
          await this.cacheArticle(file);
          this.notifyUpdate();
        }
      }
    });
    this.eventRefs.push(modifyRef);

    // File created
    const createRef = this.app.vault.on('create', async (file) => {
      if (file instanceof TFile && file.extension === 'md') {
        if (this.isInArticleFolders(file.path)) {
          console.log(`[ArticleCache] File created: ${file.path}`);
          // Small delay to let metadata cache update
          setTimeout(async () => {
            await this.cacheArticle(file);
            this.notifyUpdate();
          }, 500);
        }
      }
    });
    this.eventRefs.push(createRef);

    // File deleted
    const deleteRef = this.app.vault.on('delete', (file) => {
      if (file instanceof TFile && file.extension === 'md') {
        if (this.cache.has(file.path)) {
          console.log(`[ArticleCache] File deleted: ${file.path}`);
          this.cache.delete(file.path);
          this.notifyUpdate();
        }
      }
    });
    this.eventRefs.push(deleteRef);

    // File renamed
    const renameRef = this.app.vault.on('rename', async (file, oldPath) => {
      if (file instanceof TFile && file.extension === 'md') {
        // Remove old path from cache
        if (this.cache.has(oldPath)) {
          console.log(`[ArticleCache] File renamed: ${oldPath} -> ${file.path}`);
          this.cache.delete(oldPath);
        }
        // Add new path if in article folders
        if (this.isInArticleFolders(file.path)) {
          await this.cacheArticle(file);
        }
        this.notifyUpdate();
      }
    });
    this.eventRefs.push(renameRef);

    // Metadata changed (frontmatter updates)
    const metadataRef = this.app.metadataCache.on('changed', async (file) => {
      if (file instanceof TFile && file.extension === 'md') {
        if (this.cache.has(file.path)) {
          console.log(`[ArticleCache] Metadata changed: ${file.path}`);
          await this.cacheArticle(file);
          this.notifyUpdate();
        }
      }
    });
    this.eventRefs.push(metadataRef);
  }

  /**
   * Check if a path is in the article folders
   */
  private isInArticleFolders(path: string): boolean {
    return this.articleFolders.some(folder =>
      path.startsWith(folder + '/') || path === folder
    );
  }

  /**
   * Notify all update callbacks
   */
  private notifyUpdate(): void {
    for (const callback of this.onUpdateCallbacks) {
      try {
        callback();
      } catch (error) {
        console.error('[ArticleCache] Error in update callback:', error);
      }
    }
  }
}
