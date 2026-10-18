import { normalizePath } from './webdav';

/**
 * AAC 5.1 copies of Dolby Atmos tracks live flat in one folder outside
 * MUSIC_ROOT and are paired with their original by file name alone.
 */
export const DEFAULT_AAC51_ROOT = '/ascooo-music/Music-Transcode/aac51';

export const aac51Root = (value: string | undefined) => normalizePath(value?.trim() || DEFAULT_AAC51_ROOT);

/** File names are compared composed and case-insensitively, as PikPak may return either form. */
export const aac51Key = (path: string) => path.slice(path.lastIndexOf('/') + 1).normalize('NFC').toLowerCase();

export interface AlternateSource {
  path: string;
  size: number;
  etag: string | null;
}
