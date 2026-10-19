export interface LyricWord {
  time: number;
  end: number;
  text: string;
}

export interface LyricLine {
  time: number; // seconds
  end?: number;
  text: string;
  words?: LyricWord[];
  interlude?: boolean; // synthesized • • • row for an instrumental gap
}

const TIME = /\[(\d{1,3}):(\d{2})(?:[.:](\d{1,3}))?\]/g;
const OFFSET = /^\[offset:\s*([+-]?\d+)\s*\]/im;

/** Parse LRC text; supports multiple timestamps per line and the [offset:] tag. */
export function parseLrc(content: string): LyricLine[] {
  const offsetMatch = content.match(OFFSET);
  const offset = offsetMatch ? Number(offsetMatch[1]) / 1000 : 0;
  const out: LyricLine[] = [];

  for (const raw of content.split(/\r?\n/)) {
    const stamps: number[] = [];
    let last = 0;
    TIME.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = TIME.exec(raw))) {
      if (m.index !== last) break; // timestamps must be contiguous at line start
      const frac = m[3] ? Number(m[3].padEnd(3, '0')) / 1000 : 0;
      stamps.push(Number(m[1]) * 60 + Number(m[2]) + frac - offset);
      last = TIME.lastIndex;
    }
    if (!stamps.length) continue;
    // Strip inline word-level timestamps like <00:12.34>
    const text = raw.slice(last).replace(/<\d{1,3}:\d{2}(?:[.:]\d{1,3})?>/g, '').trim();
    for (const t of stamps) out.push({ time: Math.max(0, t), text });
  }
  return out.sort((a, b) => a.time - b.time);
}

function ttmlTime(value: string | null): number | null {
  if (!value) return null;
  const normalized = value.trim().replace(',', '.');
  if (/^-?\d+(?:\.\d+)?ms$/i.test(normalized)) return Number(normalized.slice(0, -2)) / 1000;
  if (/^-?\d+(?:\.\d+)?s$/i.test(normalized)) return Number(normalized.slice(0, -1));
  if (/^-?\d+(?:\.\d+)?$/.test(normalized)) return Number(normalized);
  const parts = normalized.split(':').map(Number);
  if (parts.some((part) => !Number.isFinite(part))) return null;
  return parts.reduce((seconds, part) => seconds * 60 + part, 0);
}

const normalizedText = (value: string | null | undefined) => (value ?? '').replace(/[\t\r\n ]+/g, ' ').trim();

/**
 * Apple times its TTML against the stereo master. A Dolby Atmos mix can start later, so the file
 * carries `<audio role="spatial" lyricOffset="\u2026"/>`: the seconds to add when the spatial mix plays.
 */
function spatialOffset(document: Document): number {
  const audio = Array.from(document.getElementsByTagNameNS('*', 'audio'))
    .find((element) => element.getAttribute('role') === 'spatial');
  const offset = Number(audio?.getAttribute('lyricOffset'));
  return Number.isFinite(offset) ? offset : 0;
}

/** Parse Apple Music TTML without rendering its XML as HTML. Pass `spatial` when the Atmos mix is playing. */
export function parseTtml(content: string, { spatial = false } = {}): LyricLine[] {
  if (typeof DOMParser === 'undefined') return [];
  const document = new DOMParser().parseFromString(content.replace(/^\uFEFF/, ''), 'application/xml');
  if (document.querySelector('parsererror')) return [];
  const offset = spatial ? spatialOffset(document) : 0;
  const at = (value: string | null) => {
    const seconds = ttmlTime(value);
    return seconds === null ? null : seconds + offset;
  };
  const paragraphs = Array.from(document.getElementsByTagNameNS('*', 'p'));
  const lines: LyricLine[] = [];

  for (const paragraph of paragraphs) {
    const spans = Array.from(paragraph.getElementsByTagNameNS('*', 'span')).filter((span) => {
      if (!span.hasAttribute('begin')) return false;
      return !Array.from(span.getElementsByTagNameNS('*', 'span')).some((child) => child.hasAttribute('begin'));
    });
    const words: LyricWord[] = [];
    for (const span of spans) {
      const time = at(span.getAttribute('begin'));
      if (time === null) continue;
      const end = at(span.getAttribute('end')) ?? time;
      let text = span.textContent ?? '';
      for (let sibling = span.nextSibling; sibling?.nodeType === Node.TEXT_NODE; sibling = sibling.nextSibling) {
        text += sibling.textContent ?? '';
      }
      if (text) words.push({ time: Math.max(0, time), end: Math.max(time, end), text });
    }

    const text = normalizedText(paragraph.textContent);
    if (!text) continue;
    const lineTime = at(paragraph.getAttribute('begin')) ?? words[0]?.time ?? null;
    if (lineTime === null) continue;
    const lineEnd = at(paragraph.getAttribute('end')) ?? words.at(-1)?.end;
    lines.push({
      time: Math.max(0, lineTime),
      ...(lineEnd === undefined || lineEnd === null ? {} : { end: Math.max(lineTime, lineEnd) }),
      text,
      ...(words.length ? { words } : {}),
    });
  }
  return lines.sort((a, b) => a.time - b.time);
}

/** Plain (unsynced) lyrics → lines, dropping any stray LRC metadata tags. */
export function plainLines(content: string): string[] {
  return content
    .split(/\r?\n/)
    .map((l) => l.replace(/^\[[a-z]+:.*\]$/i, '').trim())
    .filter((l, i, arr) => l || (i > 0 && arr[i - 1]));
}

const INTERLUDE_MIN = 5; // seconds of silence before a gap earns a • • • row
const INTERLUDE_LINGER = 1; // let the last sung line stay lit a beat before the dots take over

/**
 * TTML has no instrumental marker: a long silence between one line's end and the next line's
 * start is the interlude (or the intro, before the first line). LRC has no end times, so it's left alone.
 */
export function withInterludes(lines: LyricLine[]): LyricLine[] {
  if (!lines.some((line) => line.end !== undefined)) return lines;
  const out: LyricLine[] = [];
  let sungUntil = 0;
  for (const line of lines) {
    if (line.time - sungUntil >= INTERLUDE_MIN) {
      out.push({ time: out.length ? sungUntil + INTERLUDE_LINGER : 0, end: line.time, text: '', interlude: true });
    }
    out.push(line);
    // Overlapping lines (duets, background vocals) can end after the next one starts.
    sungUntil = Math.max(sungUntil, line.end ?? line.time);
  }
  return out;
}

/** Binary search: index of the line active at `time`. */
export function activeIndex(lines: LyricLine[], time: number): number {
  let lo = 0;
  let hi = lines.length - 1;
  let ans = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (lines[mid].time <= time + 0.15) {
      ans = mid;
      lo = mid + 1;
    } else hi = mid - 1;
  }
  return ans;
}
