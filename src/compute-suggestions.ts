/**
 * Pure functions for computing link suggestions
 */

import { LinkCandidate, LinkSuggestion, ComputeOptions } from './types';

/**
 * Normalize text for comparison (lowercase, normalize accents)
 */
function normalizeText(text: string): string {
  return text
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, ''); // Remove diacritics
}

/**
 * Compute Levenshtein distance between two strings
 */
function levenshteinDistance(a: string, b: string): number {
  const matrix: number[][] = [];

  // Initialize matrix
  for (let i = 0; i <= b.length; i++) {
    matrix[i] = [i];
  }
  for (let j = 0; j <= a.length; j++) {
    matrix[0][j] = j;
  }

  // Fill matrix
  for (let i = 1; i <= b.length; i++) {
    for (let j = 1; j <= a.length; j++) {
      if (b.charAt(i - 1) === a.charAt(j - 1)) {
        matrix[i][j] = matrix[i - 1][j - 1];
      } else {
        matrix[i][j] = Math.min(
          matrix[i - 1][j - 1] + 1, // substitution
          matrix[i][j - 1] + 1,     // insertion
          matrix[i - 1][j] + 1      // deletion
        );
      }
    }
  }

  return matrix[b.length][a.length];
}

/**
 * Check if a position overlaps with any wiki-link [[...]]
 */
function isInsideWikiLink(text: string, start: number, end: number): boolean {
  const wikiLinkRegex = /\[\[([^\]]+)\]\]/g;
  let match;
  while ((match = wikiLinkRegex.exec(text)) !== null) {
    const linkStart = match.index;
    const linkEnd = match.index + match[0].length;
    if (start < linkEnd && end > linkStart) {
      return true;
    }
  }
  return false;
}

/**
 * Check if a position overlaps with a markdown link [text](url)
 */
function isInsideMarkdownLink(text: string, start: number, end: number): boolean {
  const mdLinkRegex = /\[([^\]]+)\]\([^)]+\)/g;
  let match;
  while ((match = mdLinkRegex.exec(text)) !== null) {
    const linkStart = match.index;
    const linkEnd = match.index + match[0].length;
    if (start < linkEnd && end > linkStart) {
      return true;
    }
  }
  return false;
}

/**
 * Check if a position is inside code (inline or block)
 */
function isInsideCode(text: string, start: number, end: number): boolean {
  // Check code blocks ```...```
  const codeBlockRegex = /```[\s\S]*?```/g;
  let match;
  while ((match = codeBlockRegex.exec(text)) !== null) {
    if (start < match.index + match[0].length && end > match.index) {
      return true;
    }
  }
  // Check inline code `...`
  const inlineCodeRegex = /`[^`]+`/g;
  while ((match = inlineCodeRegex.exec(text)) !== null) {
    if (start < match.index + match[0].length && end > match.index) {
      return true;
    }
  }
  return false;
}

/**
 * Check if position is inside frontmatter (YAML block at start)
 */
function isInsideFrontmatter(text: string, start: number): boolean {
  if (!text.startsWith('---')) return false;
  const endIndex = text.indexOf('\n---', 3);
  if (endIndex === -1) return false;
  return start < endIndex + 4;
}

interface Occurrence {
  start: number;
  end: number;
  matchedText: string;
  distance: number; // Levenshtein distance (0 = exact match)
}

/**
 * Find all exact occurrences of a search term in text
 */
function findExactOccurrences(text: string, searchTerm: string): Occurrence[] {
  const occurrences: Occurrence[] = [];
  const normalizedText = normalizeText(text);
  const normalizedSearch = normalizeText(searchTerm);

  if (!normalizedSearch || normalizedSearch.length < 2) {
    return occurrences;
  }

  let pos = 0;
  while ((pos = normalizedText.indexOf(normalizedSearch, pos)) !== -1) {
    const start = pos;
    const end = pos + searchTerm.length;
    const matchedText = text.substring(start, end);

    // Skip if inside existing link, code, or frontmatter
    if (
      !isInsideWikiLink(text, start, end) &&
      !isInsideMarkdownLink(text, start, end) &&
      !isInsideCode(text, start, end) &&
      !isInsideFrontmatter(text, start)
    ) {
      occurrences.push({ start, end, matchedText, distance: 0 });
    }
    pos++;
  }

  return occurrences;
}

/**
 * Extract words from text (for fuzzy matching)
 */
function extractWords(text: string): Array<{ word: string; start: number; end: number }> {
  const words: Array<{ word: string; start: number; end: number }> = [];
  // Match words (including accented characters and hyphens)
  const wordRegex = /[\p{L}\p{N}][\p{L}\p{N}\-']*/gu;
  let match;
  while ((match = wordRegex.exec(text)) !== null) {
    words.push({
      word: match[0],
      start: match.index,
      end: match.index + match[0].length,
    });
  }
  return words;
}

/**
 * Find fuzzy matches for a search term in text
 */
function findFuzzyOccurrences(
  text: string,
  searchTerm: string,
  maxDistance: number
): Occurrence[] {
  const occurrences: Occurrence[] = [];
  const normalizedSearch = normalizeText(searchTerm);

  if (!normalizedSearch || normalizedSearch.length < 3) {
    return occurrences;
  }

  const words = extractWords(text);
  const searchWords = searchTerm.split(/\s+/);

  // For single-word search terms, find similar words
  if (searchWords.length === 1) {
    for (const { word, start, end } of words) {
      const normalizedWord = normalizeText(word);

      // Skip if word length is too different
      if (Math.abs(normalizedWord.length - normalizedSearch.length) > maxDistance) {
        continue;
      }

      const distance = levenshteinDistance(normalizedWord, normalizedSearch);

      if (distance > 0 && distance <= maxDistance) {
        // Skip if inside existing link, code, or frontmatter
        if (
          !isInsideWikiLink(text, start, end) &&
          !isInsideMarkdownLink(text, start, end) &&
          !isInsideCode(text, start, end) &&
          !isInsideFrontmatter(text, start)
        ) {
          occurrences.push({
            start,
            end,
            matchedText: word,
            distance,
          });
        }
      }
    }
  } else {
    // For multi-word search terms, try to find consecutive word sequences
    const searchTermNormalized = normalizeText(searchTerm);

    for (let i = 0; i < words.length; i++) {
      // Try to build a phrase from consecutive words
      let phrase = '';
      let phraseEnd = words[i].start;

      for (let j = i; j < Math.min(i + searchWords.length + 1, words.length); j++) {
        if (j > i) phrase += ' ';
        phrase += words[j].word;
        phraseEnd = words[j].end;

        const normalizedPhrase = normalizeText(phrase);

        // Skip if phrase length is too different
        if (Math.abs(normalizedPhrase.length - searchTermNormalized.length) > maxDistance * 2) {
          continue;
        }

        const distance = levenshteinDistance(normalizedPhrase, searchTermNormalized);

        if (distance > 0 && distance <= maxDistance * Math.max(1, searchWords.length)) {
          const start = words[i].start;
          const end = phraseEnd;

          // Skip if inside existing link, code, or frontmatter
          if (
            !isInsideWikiLink(text, start, end) &&
            !isInsideMarkdownLink(text, start, end) &&
            !isInsideCode(text, start, end) &&
            !isInsideFrontmatter(text, start)
          ) {
            occurrences.push({
              start,
              end,
              matchedText: text.substring(start, end),
              distance,
            });
          }
        }
      }
    }
  }

  // Sort by distance (best matches first)
  return occurrences.sort((a, b) => a.distance - b.distance);
}

/**
 * Find all occurrences (exact + fuzzy) of a search term in text
 */
function findOccurrences(
  text: string,
  searchTerm: string,
  enableFuzzy: boolean = false,
  fuzzyThreshold: number = 2
): Occurrence[] {
  // First, find exact matches
  const exactMatches = findExactOccurrences(text, searchTerm);

  if (!enableFuzzy) {
    return exactMatches;
  }

  // Then find fuzzy matches
  const fuzzyMatches = findFuzzyOccurrences(text, searchTerm, fuzzyThreshold);

  // Combine and deduplicate (prefer exact matches)
  const allMatches = [...exactMatches];
  const usedPositions = new Set(exactMatches.map(m => `${m.start}-${m.end}`));

  for (const fuzzy of fuzzyMatches) {
    const key = `${fuzzy.start}-${fuzzy.end}`;
    if (!usedPositions.has(key)) {
      allMatches.push(fuzzy);
      usedPositions.add(key);
    }
  }

  return allMatches.sort((a, b) => a.distance - b.distance || a.start - b.start);
}

/**
 * Extract context around a match
 */
function extractContext(
  text: string,
  start: number,
  end: number,
  contextChars: number
): string {
  const contextStart = Math.max(0, start - contextChars);
  const contextEnd = Math.min(text.length, end + contextChars);

  let context = '';
  if (contextStart > 0) context += '...';
  context += text.substring(contextStart, start);
  context += `[${text.substring(start, end)}]`;
  context += text.substring(end, contextEnd);
  if (contextEnd < text.length) context += '...';

  return context.replace(/\n/g, ' ');
}

interface Block {
  text: string;
  start: number;
  end: number;
}

/**
 * Split note text into blocks (paragraphs separated by blank lines)
 */
function splitIntoBlocks(noteText: string): Block[] {
  const blocks: Block[] = [];
  const parts = noteText.split(/\n\s*\n/);

  let currentPos = 0;
  for (const part of parts) {
    const trimmed = part.trim();
    if (trimmed) {
      const start = noteText.indexOf(part, currentPos);
      const end = start + part.length;
      blocks.push({ text: part, start, end });
      currentPos = end;
    } else {
      currentPos += part.length + 2;
    }
  }

  return blocks;
}

/**
 * Extended options for computing suggestions
 */
export interface ExtendedComputeOptions extends ComputeOptions {
  enableFuzzyMatch?: boolean;
  fuzzyThreshold?: number;
}

/**
 * Compute link suggestions for a note based on candidate notes
 *
 * @param noteText - Full markdown content of the active note
 * @param candidates - Notes returned by Smart Connections
 * @param options - Configuration options
 * @returns Array of link suggestions
 */
export function computeLinkSuggestions(
  noteText: string,
  candidates: LinkCandidate[],
  options: ExtendedComputeOptions = {}
): LinkSuggestion[] {
  const {
    maxSuggestionsPerNote = 3,
    maxTotalSuggestions = 50,
    contextChars = 30,
    enableFuzzyMatch = true,
    fuzzyThreshold = 2,
  } = options;

  const suggestions: LinkSuggestion[] = [];
  const usedTargets = new Map<string, number>(); // path -> count
  const blocks = splitIntoBlocks(noteText);

  for (const candidate of candidates) {
    if (suggestions.length >= maxTotalSuggestions) break;

    const currentCount = usedTargets.get(candidate.path) || 0;
    if (currentCount >= maxSuggestionsPerNote) continue;

    // Collect all search terms for this candidate
    const searchTerms = [candidate.title];
    if (candidate.aliases && Array.isArray(candidate.aliases)) {
      searchTerms.push(...candidate.aliases);
    }

    // Search through blocks
    for (let blockIndex = 0; blockIndex < blocks.length; blockIndex++) {
      if ((usedTargets.get(candidate.path) || 0) >= maxSuggestionsPerNote) break;
      if (suggestions.length >= maxTotalSuggestions) break;

      const block = blocks[blockIndex];

      for (const term of searchTerms) {
        if ((usedTargets.get(candidate.path) || 0) >= maxSuggestionsPerNote) break;

        const occurrences = findOccurrences(
          block.text,
          term,
          enableFuzzyMatch,
          fuzzyThreshold
        );

        for (const occ of occurrences) {
          if ((usedTargets.get(candidate.path) || 0) >= maxSuggestionsPerNote) break;
          if (suggestions.length >= maxTotalSuggestions) break;

          // Check if we already have a suggestion at this position
          const globalStart = block.start + occ.start;
          const globalEnd = block.start + occ.end;
          const alreadyExists = suggestions.some(
            s => s.globalStart === globalStart && s.globalEnd === globalEnd
          );

          if (!alreadyExists) {
            suggestions.push({
              blockIndex,
              blockText: block.text,
              matchedText: occ.matchedText,
              start: occ.start,
              end: occ.end,
              globalStart,
              globalEnd,
              targetTitle: candidate.title,
              targetPath: candidate.path,
              context: extractContext(
                block.text,
                occ.start,
                occ.end,
                contextChars
              ),
            });

            usedTargets.set(candidate.path, (usedTargets.get(candidate.path) || 0) + 1);
          }
        }
      }
    }
  }

  return suggestions.slice(0, maxTotalSuggestions);
}
