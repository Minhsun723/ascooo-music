import { type AudioMetadata, type RangeReader, clean, latin1, parseNumberPair, parseYear, u24be, u32be, u32le, utf8 } from './reader';

/** Parse Vorbis comments (shared by FLAC; also used for OGG if added later). */
export function applyVorbisComments(b: Uint8Array, meta: AudioMetadata): void {
  let p = 0;
  const vendorLen = u32le(b, p);
  p += 4 + vendorLen;
  const count = u32le(b, p);
  p += 4;
  const tags: Record<string, string> = {};
  for (let i = 0; i < count && p + 4 <= b.length; i++) {
    const len = u32le(b, p);
    p += 4;
    const kv = utf8(b.subarray(p, p + len));
    p += len;
    const eq = kv.indexOf('=');
    if (eq <= 0) continue;
    const key = kv.slice(0, eq).toUpperCase();
    if (!(key in tags)) tags[key] = kv.slice(eq + 1);
  }
  meta.title ??= clean(tags.TITLE);
  meta.artist ??= clean(tags.ARTIST);
  meta.albumArtist ??= clean(tags.ALBUMARTIST ?? tags['ALBUM ARTIST']);
  meta.album ??= clean(tags.ALBUM);
  meta.trackNo ??= parseNumberPair(tags.TRACKNUMBER);
  meta.discNo ??= parseNumberPair(tags.DISCNUMBER);
  meta.year ??= parseYear(tags.DATE ?? tags.YEAR ?? tags.ORIGINALDATE);
  meta.genre ??= clean(tags.GENRE);
  meta.recordLabel ??= clean(tags.LABEL ?? tags.ORGANIZATION ?? tags.PUBLISHER ?? tags.RECORDLABEL ?? tags.RECORD_LABEL);
  const lyr = tags.LYRICS ?? tags.UNSYNCEDLYRICS ?? tags.SYNCEDLYRICS;
  if (lyr?.trim()) meta.lyrics ??= lyr.trim();
}

export async function parseFlac(r: RangeReader, start: number, meta: AudioMetadata): Promise<void> {
  meta.codec = 'flac';
  let p = start + 4; // skip "fLaC"
  for (let guard = 0; guard < 64; guard++) {
    const h = await r.read(p, 4);
    if (h.length < 4) break;
    const last = (h[0] & 0x80) !== 0;
    const type = h[0] & 0x7f;
    const len = u24be(h, 1);
    p += 4;

    if (type === 0) {
      const s = await r.read(p, 34);
      const sampleRate = (s[10] << 12) | (s[11] << 4) | (s[12] >> 4);
      const channels = ((s[12] >> 1) & 0x07) + 1;
      const bitDepth = (((s[12] & 1) << 4) | (s[13] >> 4)) + 1;
      const totalSamples = (s[13] & 0x0f) * 2 ** 32 + u32be(s, 14);
      meta.sampleRate = sampleRate;
      meta.channels = channels;
      meta.bitDepth = bitDepth;
      if (sampleRate && totalSamples) {
        meta.duration = totalSamples / sampleRate;
        meta.bitrate = Math.round(((r.size - p) * 8) / meta.duration / 1000);
      }
    } else if (type === 4) {
      applyVorbisComments(await r.read(p, len), meta);
    } else if (type === 6 && !meta.picture && len < 4 * 1024 * 1024) {
      const b = await r.read(p, len);
      let q = 0;
      const picType = u32be(b, q); q += 4;
      const mimeLen = u32be(b, q); q += 4;
      const mime = latin1(b, q, q + mimeLen) || 'image/jpeg'; q += mimeLen;
      const descLen = u32be(b, q); q += 4 + descLen;
      q += 16; // width, height, depth, colors
      const dataLen = u32be(b, q); q += 4;
      if (picType === 3 || picType === 0 || !meta.picture) {
        meta.picture = { mime, data: b.slice(q, q + dataLen) };
      }
    }
    p += len;
    if (last) break;
  }
}
