/**
 * Frontmatter-based link matcher
 *
 * Scans articles to build an index from frontmatter (title, focus_keyword, tags)
 * Then finds these terms in the current note to suggest links.
 */

import { App, TFile, TFolder } from 'obsidian';
import { LinkSuggestion } from './types';
import { CachedArticle } from './article-cache';

export interface ConceptEntry {
  /** The term to search for */
  term: string;
  /** Path to the target article */
  targetPath: string;
  /** Title of the target article */
  targetTitle: string;
  /** Source of the term: 'title', 'focus_keyword', or 'tag' */
  source: 'title' | 'focus_keyword' | 'tag';
}

export interface FrontmatterMatchResult {
  suggestions: LinkSuggestion[];
  totalMatches: number;
}

/**
 * Build an index of concepts from article frontmatters
 */
export async function buildConceptIndex(
  app: App,
  articleFolders: string[] = ['Articles']
): Promise<ConceptEntry[]> {
  const entries: ConceptEntry[] = [];
  const seenTerms = new Set<string>();

  for (const folderPath of articleFolders) {
    const folder = app.vault.getAbstractFileByPath(folderPath);
    if (!(folder instanceof TFolder)) continue;

    await scanFolder(app, folder, entries, seenTerms);
  }

  console.log(`[Frontmatter Matcher] Built index with ${entries.length} concepts from ${seenTerms.size} unique terms`);
  return entries;
}

async function scanFolder(
  app: App,
  folder: TFolder,
  entries: ConceptEntry[],
  seenTerms: Set<string>
): Promise<void> {
  for (const child of folder.children) {
    if (child instanceof TFolder) {
      // Skip hidden folders
      if (child.name.startsWith('.') || child.name.startsWith('_')) continue;
      await scanFolder(app, child, entries, seenTerms);
    } else if (child instanceof TFile && child.extension === 'md') {
      // Only index preprint or final articles
      if (!child.name.includes('_6_preprint') && !child.name.includes('_published')) {
        // Check if it's a standalone article (no pipeline suffix)
        const hasPipelineSuffix = /_\d_\w+\.md$/.test(child.name);
        if (hasPipelineSuffix) continue;
      }

      const cache = app.metadataCache.getFileCache(child);
      if (!cache?.frontmatter) continue;

      const fm = cache.frontmatter;
      const targetPath = child.path;
      const targetTitle = fm.title || child.basename;

      // Add title
      if (fm.title && typeof fm.title === 'string') {
        addEntry(entries, seenTerms, {
          term: fm.title,
          targetPath,
          targetTitle,
          source: 'title',
        });
      }

      // Add focus_keyword
      if (fm.focus_keyword && typeof fm.focus_keyword === 'string') {
        addEntry(entries, seenTerms, {
          term: fm.focus_keyword,
          targetPath,
          targetTitle,
          source: 'focus_keyword',
        });
      }

      // Add tags
      if (fm.tags) {
        const tags = Array.isArray(fm.tags) ? fm.tags : [fm.tags];
        for (const tag of tags) {
          if (typeof tag === 'string' && tag.length > 3) {
            addEntry(entries, seenTerms, {
              term: tag,
              targetPath,
              targetTitle,
              source: 'tag',
            });
          }
        }
      }
    }
  }
}

function addEntry(
  entries: ConceptEntry[],
  seenTerms: Set<string>,
  entry: ConceptEntry
): void {
  const normalizedTerm = entry.term.toLowerCase().trim();

  // Skip very short terms (likely noise)
  if (normalizedTerm.length < 3) return;

  // Skip if we already have this exact term pointing to same target
  const key = `${normalizedTerm}:${entry.targetPath}`;
  if (seenTerms.has(key)) return;

  seenTerms.add(key);
  entries.push({
    ...entry,
    term: entry.term.trim(),
  });
}

/**
 * Find concepts in text and return link suggestions
 */
export function findConceptsInText(
  noteText: string,
  notePath: string,
  conceptIndex: ConceptEntry[],
  options: {
    maxSuggestionsPerTarget?: number;
    maxTotalSuggestions?: number;
    minTermLength?: number;
  } = {}
): FrontmatterMatchResult {
  const {
    maxSuggestionsPerTarget = 2,
    maxTotalSuggestions = 20,
    minTermLength = 4,
  } = options;

  const suggestions: LinkSuggestion[] = [];
  const suggestionsPerTarget: Map<string, number> = new Map();

  // Build list of protected ranges (frontmatter, code blocks, wikilinks)
  const protectedRanges = getProtectedRanges(noteText);

  // Sort concepts by term length (longer first) for better matching
  const sortedConcepts = [...conceptIndex]
    .filter(c => c.term.length >= minTermLength)
    .filter(c => c.targetPath !== notePath) // Don't link to self
    .sort((a, b) => b.term.length - a.term.length);

  // Track positions already covered by a suggestion
  const coveredPositions: Array<{ start: number; end: number }> = [];

  for (const concept of sortedConcepts) {
    // Check per-target limit
    const targetCount = suggestionsPerTarget.get(concept.targetPath) || 0;
    if (targetCount >= maxSuggestionsPerTarget) continue;

    // Check total limit
    if (suggestions.length >= maxTotalSuggestions) break;

    // Search for the term in ORIGINAL text (case-insensitive, word boundaries)
    const regex = new RegExp(`\\b${escapeRegex(concept.term)}\\b`, 'gi');
    let match;

    while ((match = regex.exec(noteText)) !== null) {
      const start = match.index;
      const end = start + match[0].length;

      // Skip if inside a protected range (frontmatter, code, wikilink)
      if (isInProtectedRange(start, end, protectedRanges)) continue;

      // Skip if this position overlaps with an existing suggestion
      if (isOverlapping(start, end, coveredPositions)) continue;

      // Create suggestion with positions in ORIGINAL text
      const context = extractContext(noteText, start, end, match[0]);

      suggestions.push({
        blockIndex: 0,
        blockText: '',
        matchedText: match[0],
        start,
        end,
        globalStart: start,
        globalEnd: end,
        targetTitle: concept.targetTitle,
        targetPath: concept.targetPath,
        context,
      });

      // Track this position
      coveredPositions.push({ start, end });

      // Update per-target count
      suggestionsPerTarget.set(
        concept.targetPath,
        (suggestionsPerTarget.get(concept.targetPath) || 0) + 1
      );

      // Only take first match per concept
      break;
    }
  }

  // Sort by position in text
  suggestions.sort((a, b) => a.globalStart - b.globalStart);

  return {
    suggestions,
    totalMatches: suggestions.length,
  };
}

/**
 * Get all protected ranges that should not contain links
 */
function getProtectedRanges(text: string): Array<{ start: number; end: number }> {
  const ranges: Array<{ start: number; end: number }> = [];

  // Frontmatter (at start of file)
  const frontmatterMatch = text.match(/^---\n[\s\S]*?\n---\n/);
  if (frontmatterMatch) {
    ranges.push({ start: 0, end: frontmatterMatch[0].length });
  }

  // Code blocks ```...```
  const codeBlockRegex = /```[\s\S]*?```/g;
  let match;
  while ((match = codeBlockRegex.exec(text)) !== null) {
    ranges.push({ start: match.index, end: match.index + match[0].length });
  }

  // Inline code `...`
  const inlineCodeRegex = /`[^`]+`/g;
  while ((match = inlineCodeRegex.exec(text)) !== null) {
    ranges.push({ start: match.index, end: match.index + match[0].length });
  }

  // Wikilinks [[...]]
  const wikilinkRegex = /\[\[[^\]]+\]\]/g;
  while ((match = wikilinkRegex.exec(text)) !== null) {
    ranges.push({ start: match.index, end: match.index + match[0].length });
  }

  // Markdown links [text](url)
  const mdLinkRegex = /\[[^\]]*\]\([^)]+\)/g;
  while ((match = mdLinkRegex.exec(text)) !== null) {
    ranges.push({ start: match.index, end: match.index + match[0].length });
  }

  return ranges;
}

/**
 * Check if a position is inside any protected range
 */
function isInProtectedRange(
  start: number,
  end: number,
  ranges: Array<{ start: number; end: number }>
): boolean {
  for (const range of ranges) {
    if (start >= range.start && end <= range.end) {
      return true;
    }
    // Also check partial overlap
    if (start < range.end && end > range.start) {
      return true;
    }
  }
  return false;
}

function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function isOverlapping(
  start: number,
  end: number,
  ranges: Array<{ start: number; end: number }>
): boolean {
  for (const range of ranges) {
    if (start < range.end && end > range.start) {
      return true;
    }
  }
  return false;
}

function extractContext(
  text: string,
  start: number,
  end: number,
  matchedText: string,
  contextChars: number = 40
): string {
  const before = text.substring(Math.max(0, start - contextChars), start);
  const after = text.substring(end, Math.min(text.length, end + contextChars));

  // Clean up context (remove newlines, trim)
  const cleanBefore = before.replace(/\n/g, ' ').trimStart();
  const cleanAfter = after.replace(/\n/g, ' ').trimEnd();

  return `${cleanBefore}[${matchedText}]${cleanAfter}`;
}

/**
 * Backlink suggestion - where another note could link TO the current note
 */
export interface FrontmatterBacklinkSuggestion {
  /** Path of the source note (where the link should be added) */
  sourcePath: string;
  /** Title of the source note */
  sourceTitle: string;
  /** The matched text in the source note */
  matchedText: string;
  /** Start position in source note */
  start: number;
  /** End position in source note */
  end: number;
  /** Context around the match */
  context: string;
  /** Which term matched (title, focus_keyword, or tag) */
  matchedTerm: string;
}

export interface FrontmatterBacklinkResult {
  suggestions: FrontmatterBacklinkSuggestion[];
  totalMatches: number;
}

/**
 * Find backlinks: places in other articles that mention the current note's terms
 * and could link to it
 */
export function findBacklinksInCache(
  currentNotePath: string,
  currentNoteFrontmatter: { title?: string; focus_keyword?: string; tags?: string[] },
  cachedArticles: CachedArticle[],
  options: {
    maxSuggestionsPerSource?: number;
    maxTotalSuggestions?: number;
    minTermLength?: number;
  } = {}
): FrontmatterBacklinkResult {
  const {
    maxSuggestionsPerSource = 2,
    maxTotalSuggestions = 30,
    minTermLength = 4,
  } = options;

  const suggestions: FrontmatterBacklinkSuggestion[] = [];
  const suggestionsPerSource: Map<string, number> = new Map();

  // Build list of terms to search for (from current note's frontmatter)
  const termsToSearch: Array<{ term: string; source: string }> = [];

  if (currentNoteFrontmatter.title && currentNoteFrontmatter.title.length >= minTermLength) {
    termsToSearch.push({ term: currentNoteFrontmatter.title, source: 'title' });
  }
  if (currentNoteFrontmatter.focus_keyword && currentNoteFrontmatter.focus_keyword.length >= minTermLength) {
    termsToSearch.push({ term: currentNoteFrontmatter.focus_keyword, source: 'focus_keyword' });
  }
  if (currentNoteFrontmatter.tags) {
    for (const tag of currentNoteFrontmatter.tags) {
      if (tag && tag.length >= minTermLength) {
        termsToSearch.push({ term: tag, source: 'tag' });
      }
    }
  }

  if (termsToSearch.length === 0) {
    return { suggestions: [], totalMatches: 0 };
  }

  // Sort by term length (longer first)
  termsToSearch.sort((a, b) => b.term.length - a.term.length);

  // Search each cached article
  for (const article of cachedArticles) {
    // Skip the current note itself
    if (article.path === currentNotePath) continue;

    // Check per-source limit
    const sourceCount = suggestionsPerSource.get(article.path) || 0;
    if (sourceCount >= maxSuggestionsPerSource) continue;

    // Check total limit
    if (suggestions.length >= maxTotalSuggestions) break;

    // Get protected ranges for this article
    const protectedRanges = getProtectedRanges(article.content);

    // Track positions already matched in this article
    const matchedPositions: Array<{ start: number; end: number }> = [];

    for (const { term, source } of termsToSearch) {
      // Check limits again
      if ((suggestionsPerSource.get(article.path) || 0) >= maxSuggestionsPerSource) break;
      if (suggestions.length >= maxTotalSuggestions) break;

      // Search for term in article content
      const regex = new RegExp(`\\b${escapeRegex(term)}\\b`, 'gi');
      let match;

      while ((match = regex.exec(article.content)) !== null) {
        const start = match.index;
        const end = start + match[0].length;

        // Skip if in protected range
        if (isInProtectedRange(start, end, protectedRanges)) continue;

        // Skip if overlaps with existing match
        if (isOverlapping(start, end, matchedPositions)) continue;

        // Found a valid match
        const context = extractContext(article.content, start, end, match[0]);

        suggestions.push({
          sourcePath: article.path,
          sourceTitle: article.title,
          matchedText: match[0],
          start,
          end,
          context,
          matchedTerm: term,
        });

        matchedPositions.push({ start, end });
        suggestionsPerSource.set(
          article.path,
          (suggestionsPerSource.get(article.path) || 0) + 1
        );

        // Only one match per term per article
        break;
      }
    }
  }

  // Sort by source path for consistent ordering
  suggestions.sort((a, b) => a.sourcePath.localeCompare(b.sourcePath));

  return {
    suggestions,
    totalMatches: suggestions.length,
  };
}
