import type { WebDAV } from '../webdav';
import { parseFlac } from './flac';
import { analyzeMpeg, parseID3v2, readID3Size } from './id3';
import { parseMp4 } from './mp4';
import { type AudioMetadata, RangeReader, latin1 } from './reader';

export type { AudioMetadata } from './reader';

/** Bump when the parsers start reading new fields, so already-synced tracks are parsed again once. */
export const METADATA_VERSION = 2;

export const AUDIO_EXTENSIONS = ['mp3', 'm4a', 'mp4', 'aac', 'flac', 'alac', 'ogg', 'opus', 'wav'];

export const extOf = (p: string) => p.slice(p.lastIndexOf('.') + 1).toLowerCase();

const MAX_ID3 = 12 * 1024 * 1024;

export async function extractMetadata(dav: WebDAV, path: string, size: number): Promise<AudioMetadata> {
  const reader = new RangeReader({ size, fetch: (s, e) => dav.readRange(path, s, e) });
  const meta: AudioMetadata = {};

  const id3Size = await readID3Size(reader);
  if (id3Size > 0 && id3Size <= MAX_ID3) {
    parseID3v2(await reader.read(0, id3Size), meta);
  }

  const head = await reader.read(id3Size, 12);
  const magic = latin1(head, 0, 4);

  if (magic === 'fLaC') {
    await parseFlac(reader, id3Size, meta);
  } else if (latin1(head, 4, 8) === 'ftyp') {
    await parseMp4(reader, meta);
  } else if (magic === 'RIFF') {
    meta.codec = 'wav';
  } else if (magic === 'OggS') {
    meta.codec = extOf(path) === 'opus' ? 'opus' : 'vorbis';
  } else {
    await analyzeMpeg(reader, id3Size, meta);
  }
  return meta;
}

/** Fallback title/artist from "Artist - Title.ext" style file names. */
export function guessFromFilename(path: string): { title: string; artist?: string; trackNo?: number } {
  let base = path.slice(path.lastIndexOf('/') + 1).replace(/\.[^.]+$/, '');
  let trackNo: number | undefined;
  const num = base.match(/^(\d{1,3})[\s.\-_]+/);
  if (num) {
    trackNo = Number(num[1]);
    base = base.slice(num[0].length);
  }
  const parts = base.split(/\s+-\s+/);
  if (parts.length >= 2) return { artist: parts[0].trim(), title: parts.slice(1).join(' - ').trim(), trackNo };
  return { title: base.trim(), trackNo };
}
