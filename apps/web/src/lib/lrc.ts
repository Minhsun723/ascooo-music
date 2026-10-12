export interface LyricLine {
  time: number; // seconds
  text: string;
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

/** Plain (unsynced) lyrics → lines, dropping any stray LRC metadata tags. */
export function plainLines(content: string): string[] {
  return content
    .split(/\r?\n/)
    .map((l) => l.replace(/^\[[a-z]+:.*\]$/i, '').trim())
    .filter((l, i, arr) => l || (i > 0 && arr[i - 1]));
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
