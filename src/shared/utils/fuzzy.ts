/**
 * Fuzzy matching utilities – support non-contiguous input like "sysu" matching "sys_user".
 */

export interface FuzzyResult {
  /** Match score (higher = better) */
  score: number;
  /** Indices of matched characters in the original text */
  indices: number[];
}

/**
 * Fuzzy match `query` against `text`.
 * Returns null if no match, otherwise a FuzzyResult with score and matched indices.
 *
 * Strategy:
 *  - Each query char must appear in order within `text` (case-insensitive).
 *  - Bonus points for:
 *    • Consecutive matches
 *    • Matching at word/start boundaries (after `_`, at position 0)
 *    • Shorter gaps between matched chars
 */
export function fuzzyMatch(text: string, query: string): FuzzyResult | null {
  if (!query) return { score: 0, indices: [] };

  const lower = text.toLowerCase();
  const q = query.toLowerCase();

  let qi = 0;
  let score = 0;
  let prevIdx = -2;
  const indices: number[] = [];

  for (let ti = 0; ti < lower.length && qi < q.length; ti++) {
    if (lower[ti] === q[qi]) {
      indices.push(ti);

      // Consecutive match bonus
      if (ti === prevIdx + 1) {
        score += 5;
      }

      // Word-boundary bonus (start of string or after _/-/./space)
      if (ti === 0 || '_- .'.includes(lower[ti - 1])) {
        score += 3;
      }

      // Gap penalty (larger gap = lower score, only for non-first match)
      if (qi > 0) {
        const gap = ti - prevIdx - 1;
        score -= Math.min(gap, 5);
      }

      prevIdx = ti;
      qi++;
    }
  }

  // All query chars matched?
  if (qi < q.length) return null;

  // Prefer shorter overall span
  const span = indices[indices.length - 1] - indices[0] + 1;
  score -= Math.floor(span / 3);

  return { score, indices };
}

/**
 * Return HTML with <mark> tags around the fuzzy-matched characters.
 */
export function fuzzyHighlight(text: string, indices: number[]): string {
  if (indices.length === 0) return text;

  const parts: string[] = [];
  let lastIdx = 0;

  for (const idx of indices) {
    if (idx > lastIdx) {
      parts.push(escapeHtml(text.slice(lastIdx, idx)));
    }
    parts.push('<mark>' + escapeHtml(text[idx]) + '</mark>');
    lastIdx = idx + 1;
  }

  if (lastIdx < text.length) {
    parts.push(escapeHtml(text.slice(lastIdx)));
  }

  return parts.join('');
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
