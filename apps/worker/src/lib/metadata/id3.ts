import {
  type AudioMetadata,
  type RangeReader,
  clean,
  latin1,
  parseNumberPair,
  parseYear,
  u32be,
  utf16,
  utf8,
} from './reader';

const synchsafe = (b: Uint8Array, o: number) =>
  ((b[o] & 0x7f) << 21) | ((b[o + 1] & 0x7f) << 14) | ((b[o + 2] & 0x7f) << 7) | (b[o + 3] & 0x7f);

function removeUnsync(b: Uint8Array): Uint8Array {
  const out = new Uint8Array(b.length);
  let j = 0;
  for (let i = 0; i < b.length; i++) {
    out[j++] = b[i];
    if (b[i] === 0xff && b[i + 1] === 0x00) i++;
  }
  return out.subarray(0, j);
}

function decodeText(enc: number, b: Uint8Array): string {
  switch (enc) {
    case 0:
      return latin1(b);
    case 1:
      if (b[0] === 0xfe && b[1] === 0xff) return utf16(b.subarray(2), true);
      if (b[0] === 0xff && b[1] === 0xfe) return utf16(b.subarray(2), false);
      return utf16(b, false);
    case 2:
      return utf16(b, true);
    default:
      return utf8(b);
  }
}

/** Find the end of a null-terminated string, respecting UTF-16 double-null terminators. */
function termEnd(b: Uint8Array, start: number, enc: number): number {
  if (enc === 1 || enc === 2) {
    for (let i = start; i + 1 < b.length; i += 2) if (b[i] === 0 && b[i + 1] === 0) return i;
    return b.length;
  }
  const i = b.indexOf(0, start);
  return i === -1 ? b.length : i;
}

const termSize = (enc: number) => (enc === 1 || enc === 2 ? 2 : 1);

const V22_MAP: Record<string, string> = {
  TT2: 'TIT2', TP1: 'TPE1', TP2: 'TPE2', TAL: 'TALB', TRK: 'TRCK', TPA: 'TPOS',
  TYE: 'TYER', TCO: 'TCON', TPB: 'TPUB', TRC: 'TSRC', ULT: 'USLT', SLT: 'SYLT', PIC: 'APIC', TXX: 'TXXX',
};

function fmtLrcTime(ms: number): string {
  const m = Math.floor(ms / 60000);
  const s = Math.floor((ms % 60000) / 1000);
  const cs = Math.floor((ms % 1000) / 10);
  return `[${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}.${String(cs).padStart(2, '0')}]`;
}

function genreName(v: string): string {
  // "(17)" or "(17)Rock" → keep the text if present.
  const m = v.match(/^\((\d+)\)(.*)$/);
  if (m) return m[2] || ID3_GENRES[Number(m[1])] || v;
  if (/^\d+$/.test(v)) return ID3_GENRES[Number(v)] || v;
  return v;
}

const ID3_GENRES = [
  'Blues', 'Classic Rock', 'Country', 'Dance', 'Disco', 'Funk', 'Grunge', 'Hip-Hop', 'Jazz', 'Metal',
  'New Age', 'Oldies', 'Other', 'Pop', 'R&B', 'Rap', 'Reggae', 'Rock', 'Techno', 'Industrial',
  'Alternative', 'Ska', 'Death Metal', 'Pranks', 'Soundtrack', 'Euro-Techno', 'Ambient', 'Trip-Hop',
  'Vocal', 'Jazz+Funk', 'Fusion', 'Trance', 'Classical', 'Instrumental', 'Acid', 'House', 'Game',
  'Sound Clip', 'Gospel', 'Noise', 'AlternRock', 'Bass', 'Soul', 'Punk', 'Space', 'Meditative',
  'Instrumental Pop', 'Instrumental Rock', 'Ethnic', 'Gothic', 'Darkwave', 'Techno-Industrial',
  'Electronic', 'Pop-Folk', 'Eurodance', 'Dream', 'Southern Rock', 'Comedy', 'Cult', 'Gangsta',
  'Top 40', 'Christian Rap', 'Pop/Funk', 'Jungle', 'Native American', 'Cabaret', 'New Wave',
  'Psychadelic', 'Rave', 'Showtunes', 'Trailer', 'Lo-Fi', 'Tribal', 'Acid Punk', 'Acid Jazz', 'Polka',
  'Retro', 'Musical', 'Rock & Roll', 'Hard Rock',
];

/** Parse a complete ID3v2 tag (header included). */
export function parseID3v2(tag: Uint8Array, meta: AudioMetadata): void {
  const ver = tag[3];
  const flags = tag[5];
  let body = tag.subarray(10);
  const tagUnsynced = ver < 4 && !!(flags & 0x80);
  if (tagUnsynced) body = removeUnsync(body);

  let pos = 0;
  if (flags & 0x40) {
    // Extended header
    const extSize = ver === 4 ? synchsafe(body, 0) : u32be(body, 0) + 4;
    pos = extSize;
  }

  const idLen = ver === 2 ? 3 : 4;
  const hdrLen = ver === 2 ? 6 : 10;
  let syncedLyrics: string | undefined;
  let plainLyrics: string | undefined;

  while (pos + hdrLen <= body.length) {
    let id = latin1(body, pos, pos + idLen);
    if (!/^[A-Z0-9]+$/.test(id)) break;
    let size: number;
    let fflags = 0;
    if (ver === 2) size = (body[pos + 3] << 16) | (body[pos + 4] << 8) | body[pos + 5];
    else if (ver === 4) size = synchsafe(body, pos + 4);
    else size = u32be(body, pos + 4);
    if (ver >= 3) fflags = (body[pos + 8] << 8) | body[pos + 9];
    pos += hdrLen;
    if (size <= 0 || pos + size > body.length) break;

    let dataOffset = 10 + pos;
    let sourceOffsetReliable = !tagUnsynced;
    let data = body.subarray(pos, pos + size);
    pos += size;
    if (ver === 2) id = V22_MAP[id] ?? id;

    if (ver === 4) {
      if (fflags & 0x0001) {
        data = data.subarray(4); // data length indicator
        dataOffset += 4;
      }
      if (fflags & 0x0002) {
        data = removeUnsync(data);
        sourceOffsetReliable = false;
      }
    }
    if (ver >= 3 && fflags & (ver === 4 ? 0x000c : 0x00c0)) continue; // compressed / encrypted

    const enc = data[0];
    if (id[0] === 'T' && id !== 'TXXX') {
      const text = clean(decodeText(enc, data.subarray(1)));
      switch (id) {
        case 'TIT2': meta.title ??= text; break;
        case 'TPE1': meta.artist ??= text; break;
        case 'TPE2': meta.albumArtist ??= text; break;
        case 'TALB': meta.album ??= text; break;
        case 'TRCK': meta.trackNo ??= parseNumberPair(text); break;
        case 'TPOS': meta.discNo ??= parseNumberPair(text); break;
        case 'TYER':
        case 'TDRC':
        case 'TDOR': meta.year ??= parseYear(text); break;
        case 'TCON': if (text) meta.genre ??= genreName(text); break;
        case 'TPUB': meta.recordLabel ??= text; break;
        case 'TSRC': meta.isrc ??= text; break;
      }
    } else if (id === 'TXXX') {
      const dEnd = termEnd(data, 1, enc);
      const desc = decodeText(enc, data.subarray(1, dEnd)).toUpperCase();
      const value = clean(decodeText(enc, data.subarray(dEnd + termSize(enc))));
      if ((desc === 'LYRICS' || desc === 'UNSYNCEDLYRICS') && value) plainLyrics ??= value;
      if (['LABEL', 'RECORDLABEL', 'RECORD LABEL', 'PUBLISHER', 'ORGANIZATION'].includes(desc)) meta.recordLabel ??= value;
      if (desc === 'ISRC' && value) meta.isrc ??= value;
    } else if (id === 'USLT') {
      const dEnd = termEnd(data, 4, enc);
      const text = decodeText(enc, data.subarray(dEnd + termSize(enc))).trim();
      if (text) plainLyrics ??= text;
    } else if (id === 'SYLT') {
      const tsFormat = data[4];
      const contentType = data[5];
      if (tsFormat === 2 && (contentType === 1 || contentType === 0)) {
        let p = termEnd(data, 6, enc) + termSize(enc);
        const lines: string[] = [];
        while (p < data.length) {
          const e = termEnd(data, p, enc);
          const text = decodeText(enc, data.subarray(p, e)).replace(/^\n/, '');
          p = e + termSize(enc);
          if (p + 4 > data.length) break;
          const ms = u32be(data, p);
          p += 4;
          lines.push(fmtLrcTime(ms) + text);
        }
        if (lines.length) syncedLyrics ??= lines.join('\n');
      }
    } else if (id === 'APIC' && !meta.picture) {
      let p = 1;
      let mime: string;
      if (ver === 2) {
        const fmt = latin1(data, 1, 4).toLowerCase();
        mime = fmt === 'png' ? 'image/png' : 'image/jpeg';
        p = 4;
      } else {
        const mEnd = data.indexOf(0, 1);
        mime = latin1(data, 1, mEnd).toLowerCase() || 'image/jpeg';
        if (!mime.includes('/')) mime = `image/${mime === 'jpg' ? 'jpeg' : mime}`;
        p = mEnd + 1;
      }
      const picType = data[p];
      p += 1;
      p = termEnd(data, p, enc) + termSize(enc);
      // Prefer the front cover (3) but take whatever exists.
      if (picType === 3 || picType === 0 || !meta.picture) {
        meta.picture = { mime, data: data.slice(p), ...(sourceOffsetReliable ? { offset: dataOffset + p } : {}) };
      }
    }
  }

  meta.lyrics ??= syncedLyrics ?? plainLyrics;
}

// ---------- MPEG audio frame analysis (duration / bitrate) ----------

const BITRATES: Record<string, number[]> = {
  '1-1': [0, 32, 64, 96, 128, 160, 192, 224, 256, 288, 320, 352, 384, 416, 448],
  '1-2': [0, 32, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320, 384],
  '1-3': [0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320],
  '2-1': [0, 32, 48, 56, 64, 80, 96, 112, 128, 144, 160, 176, 192, 224, 256],
  '2-2': [0, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160],
};
const SAMPLE_RATES: Record<number, number[]> = {
  1: [44100, 48000, 32000],
  2: [22050, 24000, 16000],
  25: [11025, 12000, 8000],
};

export async function analyzeMpeg(r: RangeReader, audioStart: number, meta: AudioMetadata): Promise<void> {
  const buf = await r.read(audioStart, 64 * 1024);
  for (let i = 0; i + 4 < buf.length; i++) {
    if (buf[i] !== 0xff || (buf[i + 1] & 0xe0) !== 0xe0) continue;
    const vBits = (buf[i + 1] >> 3) & 3;
    const lBits = (buf[i + 1] >> 1) & 3;
    const brIdx = buf[i + 2] >> 4;
    const srIdx = (buf[i + 2] >> 2) & 3;
    if (vBits === 1 || lBits === 0 || brIdx === 0 || brIdx === 15 || srIdx === 3) continue;

    const version = vBits === 3 ? 1 : vBits === 2 ? 2 : 25;
    const layer = 4 - lBits;
    const mono = buf[i + 3] >> 6 === 3;
    const sampleRate = SAMPLE_RATES[version][srIdx];
    const brKey = version === 1 ? `1-${layer}` : layer === 1 ? '2-1' : '2-2';
    const bitrate = BITRATES[brKey][brIdx];
    const spf = layer === 1 ? 384 : layer === 2 ? 1152 : version === 1 ? 1152 : 576;

    meta.codec = layer === 3 ? 'mp3' : `mp${layer}`;
    meta.sampleRate = sampleRate;
    meta.channels = mono ? 1 : 2;

    // Xing / Info (VBR header)
    const sideInfo = version === 1 ? (mono ? 17 : 32) : mono ? 9 : 17;
    const x = i + 4 + sideInfo;
    const xTag = latin1(buf, x, x + 4);
    let frames: number | undefined;
    if ((xTag === 'Xing' || xTag === 'Info') && x + 12 <= buf.length) {
      const flags = u32be(buf, x + 4);
      if (flags & 1) frames = u32be(buf, x + 8);
    } else if (latin1(buf, i + 36, i + 40) === 'VBRI') {
      frames = u32be(buf, i + 36 + 14);
    }

    const audioBytes = r.size - (audioStart + i);
    if (frames) {
      meta.duration = (frames * spf) / sampleRate;
      meta.bitrate = Math.round((audioBytes * 8) / meta.duration / 1000);
    } else {
      meta.bitrate = bitrate;
      meta.duration = (audioBytes * 8) / (bitrate * 1000);
    }
    return;
  }
}

export async function readID3Size(r: RangeReader): Promise<number> {
  const h = await r.read(0, 10);
  if (h.length < 10 || latin1(h, 0, 3) !== 'ID3') return 0;
  const footer = h[5] & 0x10 ? 10 : 0;
  return 10 + synchsafe(h, 6) + footer;
}
