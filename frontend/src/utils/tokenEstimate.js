/**
 * Rough token estimator for UI metrics.
 *
 * Why "rough": tokenization depends on the model + tokenizer.
 * This heuristic aims to be stable and cheap:
 * - CJK chars (Chinese/Japanese/Korean) ~= 1 token each
 * - ASCII chars ~= 1 token per 4 chars
 * - Other non-ASCII chars ~= 1 token per 2 chars
 */

export function estimateTokens(text) {
  const s = String(text ?? '');
  if (!s) return 0;

  let cjk = 0;
  let ascii = 0;
  let other = 0;

  for (const ch of s) {
    const code = ch.codePointAt(0) ?? 0;

    // ASCII (fast path)
    if (code <= 0x7f) {
      ascii += 1;
      continue;
    }

    // CJK ranges (very rough)
    const isCjk =
      (code >= 0x4e00 && code <= 0x9fff) || // CJK Unified Ideographs
      (code >= 0x3400 && code <= 0x4dbf) || // CJK Extension A
      (code >= 0x3040 && code <= 0x30ff) || // Hiragana + Katakana
      (code >= 0xac00 && code <= 0xd7af); // Hangul Syllables

    if (isCjk) {
      cjk += 1;
      continue;
    }

    other += 1;
  }

  const estimate = cjk + Math.ceil(ascii / 4) + Math.ceil(other / 2);
  return Math.max(0, estimate);
}

export function formatTokenCount(tokens) {
  const n = Number(tokens);
  if (!Number.isFinite(n) || n < 0) return '0';

  const rounded = Math.round(n);
  try {
    return rounded.toLocaleString();
  } catch {
    return String(rounded);
  }
}

