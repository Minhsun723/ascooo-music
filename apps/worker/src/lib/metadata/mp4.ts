import { type AudioMetadata, type RangeReader, clean, latin1, parseYear, u16be, u32be, u64be, utf8 } from './reader';

interface Atom {
  type: string;
  start: number; // payload start within buffer
  end: number; // payload end (exclusive)
}

function* atoms(b: Uint8Array, start: number, end: number): Generator<Atom> {
  let p = start;
  while (p + 8 <= end) {
    let size = u32be(b, p);
    const type = latin1(b, p + 4, p + 8);
    let hdr = 8;
    if (size === 1) {
      size = u64be(b, p + 8);
      hdr = 16;
    } else if (size === 0) {
      size = end - p;
    }
    if (size < hdr || p + size > end) return;
    yield { type, start: p + hdr, end: p + size };
    p += size;
  }
}

function child(b: Uint8Array, parent: Atom, type: string, skip = 0): Atom | undefined {
  for (const a of atoms(b, parent.start + skip, parent.end)) if (a.type === type) return a;
  return undefined;
}

function path(b: Uint8Array, root: Atom, ...types: string[]): Atom | undefined {
  let cur: Atom | undefined = root;
  for (const t of types) {
    if (!cur) return undefined;
    cur = child(b, cur, t);
  }
  return cur;
}

const GENRES_START = ['Blues', 'Classic Rock', 'Country', 'Dance', 'Disco', 'Funk', 'Grunge', 'Hip-Hop', 'Jazz', 'Metal', 'New Age', 'Oldies', 'Other', 'Pop', 'R&B', 'Rap', 'Reggae', 'Rock'];

function parseIlst(b: Uint8Array, ilst: Atom, meta: AudioMetadata, fileOffset: number) {
  for (const item of atoms(b, ilst.start, ilst.end)) {
    let key = item.type;
    if (key === '----') {
      const name = child(b, item, 'name');
      if (name) key = '----:' + utf8(b.subarray(name.start + 4, name.end)).toUpperCase();
    }
    const data = child(b, item, 'data');
    if (!data) continue;
    const kind = u32be(b, data.start) & 0xffffff;
    const val = b.subarray(data.start + 8, data.end);
    const text = () => clean(utf8(val));

    switch (key) {
      case '\u00a9nam': meta.title ??= text(); break;
      case '\u00a9ART': meta.artist ??= text(); break;
      case 'aART': meta.albumArtist ??= text(); break;
      case '\u00a9alb': meta.album ??= text(); break;
      case '\u00a9day': meta.year ??= parseYear(text()); break;
      case '\u00a9gen': meta.genre ??= text(); break;
      case '\u00a9pub':
      case '----:LABEL':
      case '----:RECORDLABEL':
      case '----:RECORD LABEL':
      case '----:PUBLISHER':
      case '----:ORGANIZATION': meta.recordLabel ??= text(); break;
      case 'gnre': if (val.length >= 2) meta.genre ??= GENRES_START[u16be(val, 0) - 1]; break;
      case 'trkn': if (val.length >= 4) meta.trackNo ??= u16be(val, 2) || undefined; break;
      case 'disk': if (val.length >= 4) meta.discNo ??= u16be(val, 2) || undefined; break;
      case '\u00a9lyr':
      case '----:LYRICS': {
        const l = utf8(val).trim();
        if (l) meta.lyrics ??= l;
        break;
      }
      case 'covr':
        if (!meta.picture && val.length) {
          meta.picture = {
            mime: kind === 14 ? 'image/png' : 'image/jpeg',
            data: val.slice(),
            offset: fileOffset + data.start + 8,
          };
        }
        break;
    }
  }
}

function parseMetaIlst(b: Uint8Array, metaAtom: Atom, meta: AudioMetadata, fileOffset: number): boolean {
  // ISO metadata atoms are full boxes (4-byte version/flags), while older
  // QuickTime writers may omit that prefix.
  const offsets = [4, 0];
  for (const offset of offsets) {
    const ilst = child(b, metaAtom, 'ilst', offset);
    if (ilst) {
      parseIlst(b, ilst, meta, fileOffset);
      return true;
    }
  }
  return false;
}

function parseSampleEntry(b: Uint8Array, stsd: Atom, meta: AudioMetadata) {
  // stsd: version/flags (4) + entry count (4) + entries
  for (const entry of atoms(b, stsd.start + 8, stsd.end)) {
    const e = entry.start;
    meta.channels = u16be(b, e + 16);
    meta.bitDepth = u16be(b, e + 18) || undefined;
    meta.sampleRate = u16be(b, e + 24) || undefined;
    if (entry.type === 'mp4a') {
      meta.codec = 'aac';
      meta.bitDepth = undefined; // lossy: bit depth is meaningless
    } else if (entry.type === 'alac') {
      meta.codec = 'alac';
      const inner = child(b, entry, 'alac', 28);
      if (inner) {
        const q = inner.start + 4;
        meta.bitDepth = b[q + 5];
        meta.channels = b[q + 9];
        meta.sampleRate = u32be(b, q + 20);
      }
    } else if (entry.type === 'fLaC') {
      meta.codec = 'flac';
    } else if (entry.type === 'Opus') {
      meta.codec = 'opus';
    } else {
      meta.codec = entry.type.trim().toLowerCase();
    }
    return;
  }
}

export async function parseMp4(r: RangeReader, meta: AudioMetadata): Promise<void> {
  // Walk top-level atoms to locate moov (may be at the end for non-faststart files).
  let p = 0;
  let moovStart = -1;
  let moovSize = 0;
  for (let guard = 0; guard < 64 && p + 8 <= r.size; guard++) {
    const h = await r.read(p, 16);
    let size = u32be(h, 0);
    const type = latin1(h, 4, 8);
    if (size === 1) size = u64be(h, 8);
    else if (size === 0) size = r.size - p;
    if (size < 8) break;
    if (type === 'moov') {
      moovStart = p;
      moovSize = size;
      break;
    }
    p += size;
  }
  if (moovStart < 0) throw new Error('找不到 MP4 moov atom');
  if (moovSize > 32 * 1024 * 1024) throw new Error('moov atom 過大');

  const b = await r.read(moovStart, moovSize);
  const moov: Atom = { type: 'moov', start: 8, end: b.length };

  const mvhd = child(b, moov, 'mvhd');
  if (mvhd) {
    const v = b[mvhd.start];
    const timescale = v === 1 ? u32be(b, mvhd.start + 20) : u32be(b, mvhd.start + 12);
    const duration = v === 1 ? u64be(b, mvhd.start + 24) : u32be(b, mvhd.start + 16);
    if (timescale) meta.duration = duration / timescale;
  }

  for (const trak of atoms(b, moov.start, moov.end)) {
    if (trak.type !== 'trak') continue;
    const hdlr = path(b, trak, 'mdia', 'hdlr');
    if (hdlr && latin1(b, hdlr.start + 8, hdlr.start + 12) !== 'soun') continue;
    const stsd = path(b, trak, 'mdia', 'minf', 'stbl', 'stsd');
    if (stsd) parseSampleEntry(b, stsd, meta);
    break;
  }

  const udta = child(b, moov, 'udta');
  const metadataContainers = [
    udta && child(b, udta, 'meta'), // iTunes: moov/udta/meta/ilst
    child(b, moov, 'meta'),         // ISO/third-party: moov/meta/ilst
  ].filter((atom): atom is Atom => !!atom);
  for (const metaAtom of metadataContainers) parseMetaIlst(b, metaAtom, meta, moovStart);

  // A few taggers omit the `meta` wrapper entirely.
  const directIlst = (udta && child(b, udta, 'ilst')) || child(b, moov, 'ilst');
  if (directIlst) parseIlst(b, directIlst, meta, moovStart);

  if (meta.duration) meta.bitrate = Math.round((r.size * 8) / meta.duration / 1000);
}
