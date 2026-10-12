/** Random-access reader backed by HTTP Range requests, with a simple block cache. */
export interface RangeSource {
  size: number;
  fetch(start: number, end: number): Promise<Uint8Array>; // inclusive end
}

const BLOCK = 128 * 1024;

export class RangeReader {
  readonly size: number;
  private cache: { start: number; data: Uint8Array }[] = [];
  requests = 0;

  constructor(private src: RangeSource) {
    this.size = src.size;
  }

  async read(offset: number, length: number): Promise<Uint8Array> {
    if (offset >= this.size || length <= 0) return new Uint8Array(0);
    length = Math.min(length, this.size - offset);

    for (const c of this.cache) {
      if (offset >= c.start && offset + length <= c.start + c.data.length) {
        return c.data.subarray(offset - c.start, offset - c.start + length);
      }
    }
    const fetchLen = Math.max(length, BLOCK);
    const end = Math.min(this.size, offset + fetchLen) - 1;
    this.requests++;
    const data = await this.src.fetch(offset, end);
    this.cache.push({ start: offset, data });
    if (this.cache.length > 6) this.cache.shift();
    return data.subarray(0, length);
  }
}

export const latin1 = (b: Uint8Array, start = 0, end = b.length) => {
  let s = '';
  for (let i = start; i < end; i++) s += String.fromCharCode(b[i]);
  return s;
};

export const utf8 = (b: Uint8Array) => new TextDecoder('utf-8').decode(b);

export function utf16(b: Uint8Array, bigEndian: boolean): string {
  let le = b;
  if (bigEndian) {
    le = new Uint8Array(b.length - (b.length % 2));
    for (let i = 0; i + 1 < b.length; i += 2) {
      le[i] = b[i + 1];
      le[i + 1] = b[i];
    }
  }
  return new TextDecoder('utf-16le').decode(le);
}

export const u16be = (b: Uint8Array, o: number) => (b[o] << 8) | b[o + 1];
export const u24be = (b: Uint8Array, o: number) => (b[o] << 16) | (b[o + 1] << 8) | b[o + 2];
export const u32be = (b: Uint8Array, o: number) => ((b[o] << 24) | (b[o + 1] << 16) | (b[o + 2] << 8) | b[o + 3]) >>> 0;
export const u32le = (b: Uint8Array, o: number) => (b[o] | (b[o + 1] << 8) | (b[o + 2] << 16) | (b[o + 3] << 24)) >>> 0;
export const u64be = (b: Uint8Array, o: number) => u32be(b, o) * 2 ** 32 + u32be(b, o + 4);

export interface Picture {
  mime: string;
  data: Uint8Array;
  /** Absolute byte offset in the source audio file, when the parser can expose it. */
  offset?: number;
}

export interface AudioMetadata {
  title?: string;
  artist?: string;
  albumArtist?: string;
  album?: string;
  trackNo?: number;
  discNo?: number;
  year?: number;
  genre?: string;
  lyrics?: string;
  duration?: number;
  codec?: string;
  bitrate?: number; // kbps
  sampleRate?: number;
  bitDepth?: number;
  channels?: number;
  picture?: Picture;
}

export function parseNumberPair(v: string | undefined): number | undefined {
  if (!v) return undefined;
  const n = parseInt(v.split('/')[0], 10);
  return Number.isFinite(n) && n > 0 ? n : undefined;
}

export function parseYear(v: string | undefined): number | undefined {
  if (!v) return undefined;
  const m = v.match(/\d{4}/);
  return m ? Number(m[0]) : undefined;
}

export function clean(v: string | undefined | null): string | undefined {
  if (v == null) return undefined;
  const s = v.replace(/\0+$/g, '').replace(/\0/g, ' / ').trim();
  return s || undefined;
}
