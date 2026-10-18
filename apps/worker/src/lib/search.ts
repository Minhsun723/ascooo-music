/**
 * Search keys make visually identical text compare equal in SQL LIKE. Tags and
 * file names mix NFC/NFD (macOS splits "デ" into "テ" + U+3099), half-width
 * kana, full-width Latin and hiragana/katakana spellings of the same name.
 *
 * Keep this file free of imports: scripts/backfill-search-keys.mts runs it
 * directly under Node to rebuild keys for existing rows.
 */
export function searchKey(value: string | null | undefined): string {
  return (value ?? '')
    .normalize('NFKC')
    .toLowerCase()
    // Hiragana → katakana, so "ろくでなし" finds "ロクデナシ".
    .replace(/[ぁ-ゖゝゞ]/g, (c) => String.fromCharCode(c.charCodeAt(0) + 0x60))
    .replace(/[\p{P}\p{S}\s]+/gu, '');
}

/**
 * Join several fields into one key. Fields are separated by a newline, which
 * searchKey() strips from queries, so a match never spans two fields. The
 * first field is the displayed name and is used to rank prefix matches.
 */
export function joinSearchKeys(...values: (string | null | undefined)[]): string {
  return [...new Set(values.map(searchKey).filter(Boolean))].join('\n');
}

export const trackSearchKey = (t: {
  title: string;
  displayTitle?: string | null;
  artist?: string | null;
  displayArtist?: string | null;
}) => joinSearchKeys(t.displayTitle || t.title, t.title, t.displayArtist, t.artist);

export const artistSearchKey = (name: string, displayName?: string | null) => joinSearchKeys(displayName || name, name);
