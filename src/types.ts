/**
 * Type definitions for In-Note Link Suggestions plugin
 */

export interface LinkCandidate {
  /** Note title (filename without .md) */
  title: string;
  /** Aliases from frontmatter */
  aliases: string[];
  /** Full path to the note */
  path: string;
  /** Similarity score from Smart Connections */
  score: number;
}

export interface LinkSuggestion {
  /** Index of the block containing the match */
  blockIndex: number;
  /** Full text of the block */
  blockText: string;
  /** The exact text that was matched */
  matchedText: string;
  /** Start position within the block */
  start: number;
  /** End position within the block */
  end: number;
  /** Start position in the full note text */
  globalStart: number;
  /** End position in the full note text */
  globalEnd: number;
  /** Title of the target note */
  targetTitle: string;
  /** Path of the target note */
  targetPath: string;
  /** Short excerpt around the match for display */
  context: string;
}

export interface ComputeOptions {
  /** Max suggestions per target note (default: 1) */
  maxSuggestionsPerNote?: number;
  /** Max total suggestions to return (default: 15) */
  maxTotalSuggestions?: number;
  /** Characters to show before/after match in context (default: 30) */
  contextChars?: number;
}

/** View mode for the suggestions panel */
export type ViewMode = 'links-from' | 'links-to';

export interface PluginSettings {
  maxSuggestionsPerNote: number;
  maxTotalSuggestions: number;
  maxCandidates: number;
  enableSemanticMatch: boolean;
  minSemanticSimilarity: number; // 0-1, minimum similarity score
  /** Ignored suggestions per note: { notePath: ["targetPath:matchedText", ...] } */
  ignoredSuggestions: Record<string, string[]>;
  /** Ignored backlink suggestions: { activeNotePath: ["sourceNotePath:matchedText", ...] } */
  ignoredBacklinks: Record<string, string[]>;
  /** Use frontmatter-based matching instead of semantic matching */
  enableFrontmatterMatch: boolean;
  /** Folders to scan for article frontmatters */
  articleFolders: string[];
  /** Minimum term length for frontmatter matching */
  minTermLength: number;
}

export const DEFAULT_SETTINGS: PluginSettings = {
  maxSuggestionsPerNote: 3,
  maxTotalSuggestions: 20,
  maxCandidates: 30,
  enableSemanticMatch: true,
  minSemanticSimilarity: 0.6, // Lower = more suggestions, Higher = more precise
  ignoredSuggestions: {},
  ignoredBacklinks: {},
  enableFrontmatterMatch: true, // Default to frontmatter mode
  articleFolders: ['Articles'],
  minTermLength: 4,
};

/**
 * Smart Connections plugin interface (partial)
 * Based on observation of the plugin API
 */
export interface SmartConnectionsPlugin {
  env: SmartEnvironment;
}

export interface SmartEnvironment {
  smart_sources: SmartSourcesCollection;
  connections_lists: ConnectionsListsCollection;
}

export interface SmartSourcesCollection {
  get(path: string): SmartSource | undefined;
  items: Record<string, SmartSource>;
}

export interface SmartSource {
  key: string;
  path: string;
  data: Record<string, unknown>;
  connections?: ConnectionsList;
}

export interface ConnectionsListsCollection {
  new_item(source: SmartSource): ConnectionsList;
}

export interface ConnectionsList {
  get_results(opts?: { limit?: number; results_collection_key?: string }): Promise<ConnectionResult[]>;
}

export interface ConnectionResult {
  item: SmartSource;
  score: number;
}
