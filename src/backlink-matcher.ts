/**
 * Backlink matching using Smart Connections embeddings
 *
 * Strategy: Find places in OTHER notes where we can insert links TO the active note
 * 1. Smart Connections found similar NOTES (candidates)
 * 2. For each candidate note, we extract N-grams (1-4 words)
 * 3. We embed each n-gram and compare with the active note's embedding
 * 4. We identify which n-gram in the candidate best matches the active note
 */

import { App, TFile } from 'obsidian';
import { LinkCandidate } from './types';

/**
 * Word with position information
 */
interface Word {
  text: string;
  start: number;
  end: number;
}

/**
 * N-gram (1-4 words) with position
 */
interface NGram {
  text: string;
  start: number;
  end: number;
  wordCount: number;
}

/**
 * A backlink suggestion - a place in another note to insert a link to the active note
 */
export interface BacklinkSuggestion {
  /** The note where the link should be inserted */
  sourceNotePath: string;
  /** Title of the source note */
  sourceNoteTitle: string;
  /** The matched text in the source note */
  matchedText: string;
  /** Start position in the source note */
  globalStart: number;
  /** End position in the source note */
  globalEnd: number;
  /** Context around the match */
  context: string;
  /** The active note title (target of the link) */
  targetTitle: string;
  /** The active note path */
  targetPath: string;
  /** Similarity score */
  similarity: number;
}

export interface BacklinkMatchResult {
  /** Suggestions for current batch */
  suggestions: BacklinkSuggestion[];
  /** Total number of matches available */
  totalAvailable: number;
  /** Whether there are more suggestions */
  hasMore: boolean;
}

export interface BacklinkMatcherOptions {
  /** Minimum similarity score (0-1) */
  minSimilarity?: number;
  /** Max suggestions per source note */
  maxSuggestionsPerNote?: number;
  /** Max total suggestions */
  maxTotalSuggestions?: number;
  /** Max words per n-gram */
  maxNGramWords?: number;
  /** Batch size for embeddings */
  batchSize?: number;
  /** Offset for pagination */
  offset?: number;
}

/**
 * Extract words from text with positions
 */
function extractWords(text: string): Word[] {
  const words: Word[] = [];
  const wordRegex = /[\p{L}\p{N}][\p{L}\p{N}\-'']*/gu;
  let match;
  while ((match = wordRegex.exec(text)) !== null) {
    words.push({
      text: match[0],
      start: match.index,
      end: match.index + match[0].length,
    });
  }
  return words;
}

/**
 * Generate n-grams from word list
 */
function generateNGrams(words: Word[], maxN: number = 4): NGram[] {
  const ngrams: NGram[] = [];

  for (let i = 0; i < words.length; i++) {
    for (let n = 1; n <= Math.min(maxN, words.length - i); n++) {
      const ngramWords = words.slice(i, i + n);
      const text = ngramWords.map(w => w.text).join(' ');

      if (text.length < 3) continue;

      ngrams.push({
        text,
        start: ngramWords[0].start,
        end: ngramWords[n - 1].end,
        wordCount: n,
      });
    }
  }

  return ngrams;
}

/**
 * Check if position is inside frontmatter
 */
function isInFrontmatter(text: string, pos: number): boolean {
  if (!text.startsWith('---')) return false;
  const endIndex = text.indexOf('\n---', 3);
  if (endIndex === -1) return false;
  return pos < endIndex + 4;
}

/**
 * Check if position is inside code block
 */
function isInCodeBlock(text: string, pos: number): boolean {
  const codeBlockRegex = /```[\s\S]*?```/g;
  let match;
  while ((match = codeBlockRegex.exec(text)) !== null) {
    if (pos >= match.index && pos < match.index + match[0].length) {
      return true;
    }
  }
  return false;
}

/**
 * Check if position is inside existing wiki-link
 */
function isInWikiLink(text: string, pos: number): boolean {
  const wikiLinkRegex = /\[\[([^\]]+)\]\]/g;
  let match;
  while ((match = wikiLinkRegex.exec(text)) !== null) {
    if (pos >= match.index && pos < match.index + match[0].length) {
      return true;
    }
  }
  return false;
}

/**
 * Check if the note already contains a link to the target
 */
function hasLinkToTarget(text: string, targetTitle: string, targetPath: string): boolean {
  // Check for [[Target]] or [[Target|...]] or [[path/to/Target]] patterns
  const titleNoExt = targetPath.replace(/\.md$/, '');
  const patterns = [
    new RegExp(`\\[\\[${escapeRegex(targetTitle)}(\\|[^\\]]*)?\\]\\]`, 'i'),
    new RegExp(`\\[\\[${escapeRegex(titleNoExt)}(\\|[^\\]]*)?\\]\\]`, 'i'),
  ];

  return patterns.some(p => p.test(text));
}

function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Compute cosine similarity
 */
function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length) return 0;

  let dotProduct = 0;
  let normA = 0;
  let normB = 0;

  for (let i = 0; i < a.length; i++) {
    dotProduct += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }

  if (normA === 0 || normB === 0) return 0;
  return dotProduct / (Math.sqrt(normA) * Math.sqrt(normB));
}

/**
 * Extract context around a position
 */
function extractContext(text: string, start: number, end: number, contextChars: number = 30): string {
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

export interface SmartConnectionsEnv {
  smart_sources: {
    get(path: string): any;
    embed_model: {
      embed_batch(items: Array<{ embed_input: string }>): Promise<Array<{ vec: number[] }>>;
    };
  };
}

/**
 * Compute backlink suggestions - find places in other notes to link TO the active note
 */
export async function computeBacklinkSuggestions(
  app: App,
  activeFile: TFile,
  candidates: LinkCandidate[],
  scEnv: SmartConnectionsEnv,
  options: BacklinkMatcherOptions = {}
): Promise<BacklinkMatchResult> {
  const {
    minSimilarity = 0.5,
    maxSuggestionsPerNote = 3,
    maxTotalSuggestions = 10,
    maxNGramWords = 4,
    batchSize = 50,
    offset = 0,
  } = options;

  console.log('[In-Note Links] Starting backlink matching...');
  console.log('[In-Note Links] Active file:', activeFile.path);
  console.log('[In-Note Links] Candidates:', candidates.length);

  // Get active note's embedding
  const activeSource = scEnv.smart_sources.get(activeFile.path);
  if (!activeSource?.vec) {
    console.log('[In-Note Links] No embedding for active note');
    return { suggestions: [], totalAvailable: 0, hasMore: false };
  }
  const activeVec = activeSource.vec;
  const activeTitle = activeFile.basename;

  interface ScoredMatch {
    ngram: NGram;
    sourceNotePath: string;
    sourceNoteTitle: string;
    sourceNoteText: string;
    similarity: number;
  }

  const allMatches: ScoredMatch[] = [];

  // Process each candidate note
  for (const candidate of candidates) {
    // Skip if it's the active file
    if (candidate.path === activeFile.path) continue;

    // Get candidate file
    const candidateFile = app.vault.getAbstractFileByPath(candidate.path);
    if (!(candidateFile instanceof TFile)) continue;

    // Read candidate content
    let candidateText: string;
    try {
      candidateText = await app.vault.read(candidateFile);
    } catch (e) {
      console.error('[In-Note Links] Failed to read candidate:', candidate.path);
      continue;
    }

    // Skip if already links to active note
    if (hasLinkToTarget(candidateText, activeTitle, activeFile.path)) {
      console.log('[In-Note Links] Skipping (already has link):', candidate.path);
      continue;
    }

    // Extract words from candidate
    const words = extractWords(candidateText);
    const validWords = words.filter(w =>
      !isInFrontmatter(candidateText, w.start) &&
      !isInCodeBlock(candidateText, w.start) &&
      !isInWikiLink(candidateText, w.start)
    );

    if (validWords.length === 0) continue;

    // Generate n-grams
    const ngrams = generateNGrams(validWords, maxNGramWords);

    // Limit and prioritize longer n-grams
    const sortedNGrams = ngrams.sort((a, b) => b.wordCount - a.wordCount);
    const limitedNGrams = sortedNGrams.slice(0, 200); // Fewer per candidate since we have multiple candidates

    // Embed n-grams in batches
    const ngramEmbeddings: Map<string, number[]> = new Map();

    for (let i = 0; i < limitedNGrams.length; i += batchSize) {
      const batch = limitedNGrams.slice(i, i + batchSize);
      try {
        const embedInput = batch.map(ng => ({ embed_input: ng.text }));
        const results = await scEnv.smart_sources.embed_model.embed_batch(embedInput);

        for (let j = 0; j < batch.length; j++) {
          if (results[j]?.vec) {
            const key = `${batch[j].start}-${batch[j].end}`;
            ngramEmbeddings.set(key, results[j].vec);
          }
        }
      } catch (error) {
        console.error('[In-Note Links] Embedding batch failed:', error);
      }
    }

    // Compare n-grams with active note embedding
    for (const ngram of limitedNGrams) {
      const key = `${ngram.start}-${ngram.end}`;
      const ngramVec = ngramEmbeddings.get(key);
      if (!ngramVec) continue;

      const similarity = cosineSimilarity(ngramVec, activeVec);

      if (similarity >= minSimilarity) {
        allMatches.push({
          ngram,
          sourceNotePath: candidate.path,
          sourceNoteTitle: candidate.title,
          sourceNoteText: candidateText,
          similarity,
        });
      }
    }
  }

  console.log('[In-Note Links] Total backlink matches:', allMatches.length);

  // Sort by similarity
  allMatches.sort((a, b) => {
    const simDiff = b.similarity - a.similarity;
    if (Math.abs(simDiff) > 0.05) return simDiff;
    return b.ngram.wordCount - a.ngram.wordCount;
  });

  // Build suggestions list with deduplication
  const allValidSuggestions: BacklinkSuggestion[] = [];
  const sourceCounts = new Map<string, number>();
  const usedPositions = new Map<string, Set<string>>(); // per source note

  for (const match of allMatches) {
    // Check per-source limit
    const currentCount = sourceCounts.get(match.sourceNotePath) || 0;
    if (currentCount >= maxSuggestionsPerNote) continue;

    // Check position overlap within same source note
    const posKey = `${match.ngram.start}-${match.ngram.end}`;
    const usedInSource = usedPositions.get(match.sourceNotePath) || new Set();

    let overlaps = false;
    for (const used of usedInSource) {
      const [usedStart, usedEnd] = used.split('-').map(Number);
      if (match.ngram.start < usedEnd && match.ngram.end > usedStart) {
        overlaps = true;
        break;
      }
    }
    if (overlaps) continue;

    allValidSuggestions.push({
      sourceNotePath: match.sourceNotePath,
      sourceNoteTitle: match.sourceNoteTitle,
      matchedText: match.ngram.text,
      globalStart: match.ngram.start,
      globalEnd: match.ngram.end,
      context: extractContext(match.sourceNoteText, match.ngram.start, match.ngram.end, 20),
      targetTitle: activeTitle,
      targetPath: activeFile.path,
      similarity: match.similarity,
    });

    sourceCounts.set(match.sourceNotePath, currentCount + 1);
    usedInSource.add(posKey);
    usedPositions.set(match.sourceNotePath, usedInSource);
  }

  console.log('[In-Note Links] Valid backlink suggestions:', allValidSuggestions.length);

  // Apply pagination
  const paginatedSuggestions = allValidSuggestions.slice(offset, offset + maxTotalSuggestions);
  const hasMore = offset + maxTotalSuggestions < allValidSuggestions.length;

  return {
    suggestions: paginatedSuggestions,
    totalAvailable: allValidSuggestions.length,
    hasMore,
  };
}
