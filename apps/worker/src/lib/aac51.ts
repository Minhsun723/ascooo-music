import { normalizePath } from './webdav';

/**
 * AAC 5.1 copies of Dolby Atmos tracks live flat in one folder outside
 * MUSIC_ROOT and are paired with their original by file name alone.
 */
export const DEFAULT_AAC51_ROOT = '/ascooo-music/Music-Transcode/aac51';

export const aac51Root = (value: string | undefined) => normalizePath(value?.trim() || DEFAULT_AAC51_ROOT);

const fileName = (path: string) => path.slice(path.lastIndexOf('/') + 1);

/** File names are compared composed and case-insensitively, as PikPak may return either form. */
export const aac51Key = (path: string) => fileName(path).normalize('NFC').toLowerCase();

export interface AlternateSource {
  path: string;
  size: number;
  etag: string | null;
}

export interface Aac51Pairing {
  /** Original track path → its AAC 5.1 copy. */
  pairs: Map<string, AlternateSource>;
  /** File names shared by several originals or several copies, left unpaired. */
  ambiguous: string[];
  /** Copies whose name matches no original. */
  orphans: string[];
}

/**
 * The single pairing rule used by both the full local sync and the
 * AAC-only command, so either one leaves the library in the same state.
 */
export function pairAac51(originalPaths: Iterable<string>, files: AlternateSource[]): Aac51Pairing {
  const filesByName = new Map<string, AlternateSource[]>();
  for (const file of files) {
    const key = aac51Key(file.path);
    filesByName.set(key, [...(filesByName.get(key) ?? []), file]);
  }
  const originalsByName = new Map<string, string[]>();
  for (const path of originalPaths) {
    const key = aac51Key(path);
    originalsByName.set(key, [...(originalsByName.get(key) ?? []), path]);
  }

  const pairs = new Map<string, AlternateSource>();
  const ambiguous: string[] = [];
  for (const [key, originals] of originalsByName) {
    const candidates = filesByName.get(key);
    if (!candidates) continue;
    if (originals.length > 1 || candidates.length > 1) {
      ambiguous.push(fileName(candidates[0].path));
      continue;
    }
    pairs.set(originals[0], candidates[0]);
  }
  const orphans = [...filesByName]
    .filter(([key]) => !originalsByName.has(key))
    .map(([, candidates]) => fileName(candidates[0].path));
  return { pairs, ambiguous, orphans };
}
