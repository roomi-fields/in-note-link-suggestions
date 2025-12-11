/**
 * Semantic matching using Smart Connections embeddings
 *
 * Strategy: Fine-grained matching
 * 1. Smart Connections found similar NOTES (candidates)
 * 2. We extract N-grams (1-4 words) from the active note
 * 3. We embed each n-gram and compare with candidate note embeddings
 * 4. We identify which n-gram best matches each candidate
 */

import { LinkCandidate, LinkSuggestion } from './types';

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
 * Extract words from text with positions
 */
function extractWords(text: string): Word[] {
  const words: Word[] = [];
  // Match words including accented characters, hyphens, apostrophes
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
 * Generate n-grams (1-4 words) from word list
 */
function generateNGrams(words: Word[], maxN: number = 4): NGram[] {
  const ngrams: NGram[] = [];

  for (let i = 0; i < words.length; i++) {
    for (let n = 1; n <= Math.min(maxN, words.length - i); n++) {
      const ngramWords = words.slice(i, i + n);
      const text = ngramWords.map(w => w.text).join(' ');

      // Skip very short n-grams (less than 3 chars)
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
 * Compute cosine similarity between two vectors
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

export interface SemanticMatcherOptions {
  /** Minimum similarity score to consider a match (0-1) */
  minSimilarity?: number;
  /** Maximum suggestions per candidate note */
  maxSuggestionsPerNote?: number;
  /** Maximum total suggestions */
  maxTotalSuggestions?: number;
  /** Maximum words per n-gram */
  maxNGramWords?: number;
  /** Batch size for embedding requests */
  batchSize?: number;
  /** Offset for pagination (skip first N matches) */
  offset?: number;
}

export interface SemanticMatchResult {
  /** Suggestions for current batch */
  suggestions: LinkSuggestion[];
  /** Total number of matches available (above minSimilarity) */
  totalAvailable: number;
  /** Whether there are more suggestions after this batch */
  hasMore: boolean;
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
 * Compute semantic link suggestions using Smart Connections embeddings
 * with fine-grained n-gram matching (1-4 words)
 */
export async function computeSemanticSuggestions(
  noteText: string,
  candidates: LinkCandidate[],
  scEnv: SmartConnectionsEnv,
  options: SemanticMatcherOptions = {}
): Promise<SemanticMatchResult> {
  const {
    minSimilarity = 0.5,
    maxSuggestionsPerNote = 3,
    maxTotalSuggestions = 10,
    maxNGramWords = 4,
    batchSize = 50,
    offset = 0,
  } = options;

  console.log('[In-Note Links] Starting fine-grained semantic matching...');
  console.log('[In-Note Links] Candidates:', candidates.length);

  // 1. Extract words from note
  const words = extractWords(noteText);
  console.log('[In-Note Links] Words found:', words.length);

  // Filter words not in frontmatter, code blocks, or wiki-links
  const validWords = words.filter(w =>
    !isInFrontmatter(noteText, w.start) &&
    !isInCodeBlock(noteText, w.start) &&
    !isInWikiLink(noteText, w.start)
  );
  console.log('[In-Note Links] Valid words:', validWords.length);

  if (validWords.length === 0) {
    console.log('[In-Note Links] No valid words to analyze');
    return [];
  }

  // 2. Generate n-grams (1-4 words)
  const ngrams = generateNGrams(validWords, maxNGramWords);
  console.log('[In-Note Links] N-grams generated:', ngrams.length);

  // Limit n-grams to avoid too many API calls
  // Prioritize longer n-grams (more meaningful)
  const sortedNGrams = ngrams.sort((a, b) => b.wordCount - a.wordCount);
  const limitedNGrams = sortedNGrams.slice(0, 500); // Max 500 n-grams
  console.log('[In-Note Links] N-grams to process:', limitedNGrams.length);

  // 3. Embed n-grams in batches
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

  console.log('[In-Note Links] N-gram embeddings computed:', ngramEmbeddings.size);

  // 4. Compare each n-gram with each candidate
  interface ScoredMatch {
    ngram: NGram;
    candidate: LinkCandidate;
    similarity: number;
  }

  const allMatches: ScoredMatch[] = [];

  for (const candidate of candidates) {
    // Get candidate's embedding
    const candidateSource = scEnv.smart_sources.get(candidate.path);
    if (!candidateSource?.vec) {
      continue;
    }

    for (const ngram of limitedNGrams) {
      const key = `${ngram.start}-${ngram.end}`;
      const ngramVec = ngramEmbeddings.get(key);
      if (!ngramVec) continue;

      const similarity = cosineSimilarity(ngramVec, candidateSource.vec);

      if (similarity >= minSimilarity) {
        allMatches.push({
          ngram,
          candidate,
          similarity,
        });
      }
    }
  }

  console.log('[In-Note Links] Total matches before filtering:', allMatches.length);

  // 5. Sort by similarity (best first), then by n-gram length (longer = better)
  allMatches.sort((a, b) => {
    const simDiff = b.similarity - a.similarity;
    if (Math.abs(simDiff) > 0.05) return simDiff;
    return b.ngram.wordCount - a.ngram.wordCount;
  });

  // 6. Build full list of valid suggestions (without maxTotalSuggestions limit)
  const allValidSuggestions: LinkSuggestion[] = [];
  const targetCounts = new Map<string, number>();
  const usedPositions = new Set<string>();

  for (const match of allMatches) {
    // Check per-target limit
    const currentCount = targetCounts.get(match.candidate.path) || 0;
    if (currentCount >= maxSuggestionsPerNote) continue;

    // Check if position overlaps with already used position
    const posKey = `${match.ngram.start}-${match.ngram.end}`;
    let overlaps = false;
    for (const used of usedPositions) {
      const [usedStart, usedEnd] = used.split('-').map(Number);
      if (match.ngram.start < usedEnd && match.ngram.end > usedStart) {
        overlaps = true;
        break;
      }
    }
    if (overlaps) continue;

    // Add to all valid suggestions
    allValidSuggestions.push({
      blockIndex: 0,
      blockText: match.ngram.text,
      matchedText: match.ngram.text,
      start: 0,
      end: match.ngram.text.length,
      globalStart: match.ngram.start,
      globalEnd: match.ngram.end,
      targetTitle: match.candidate.title,
      targetPath: match.candidate.path,
      context: extractContext(noteText, match.ngram.start, match.ngram.end, 20),
    });

    targetCounts.set(match.candidate.path, currentCount + 1);
    usedPositions.add(posKey);
  }

  console.log('[In-Note Links] Total valid suggestions:', allValidSuggestions.length);

  // 7. Apply pagination (offset + limit)
  const paginatedSuggestions = allValidSuggestions.slice(offset, offset + maxTotalSuggestions);
  const hasMore = offset + maxTotalSuggestions < allValidSuggestions.length;

  for (const suggestion of paginatedSuggestions) {
    console.log(`[In-Note Links] Selected: "${suggestion.matchedText}" → ${suggestion.targetTitle}`);
  }

  console.log('[In-Note Links] Returning suggestions:', paginatedSuggestions.length, 'hasMore:', hasMore);

  return {
    suggestions: paginatedSuggestions,
    totalAvailable: allValidSuggestions.length,
    hasMore,
  };
}
