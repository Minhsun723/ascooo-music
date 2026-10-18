import { toKatakana } from 'wanakana';
import { searchKey } from './search';
import { likePattern } from './sql';

/**
 * LIKE patterns for a search box value. A romaji query ("rokudenashi") also
 * matches its katakana reading (ロクデナシ); stored keys stay kana-only, so
 * this needs no extra column. Kanji titles cannot be matched by reading.
 *
 * `contains`/`prefix` hold one pattern for the plain key and one for the
 * reading (the same pattern twice when the query is not romaji), so every
 * statement can bind a fixed number of parameters.
 */
export function searchPatterns(raw: string | undefined): { contains: [string, string]; prefix: [string, string] } | null {
  const key = searchKey(raw);
  if (!key) return null;
  const reading = /[a-z]/.test(key) ? romajiReading(raw!) : null;
  const contains: [string, string] = [likePattern(key), likePattern(reading ?? key)];
  return { contains, prefix: [contains[0].slice(1), contains[1].slice(1)] };
}

function romajiReading(raw: string): string | null {
  // Convert before searchKey() strips punctuation: "ro-do" → "ロード".
  const reading = searchKey(toKatakana(raw.normalize('NFKC').toLowerCase()));
  // English words convert only partly ("sunny" → "スンンy"); skip those.
  return /^[ァ-ヺー]+$/.test(reading) ? reading : null;
}
