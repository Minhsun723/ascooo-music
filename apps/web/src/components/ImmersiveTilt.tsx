import { Fragment, useLayoutEffect, useMemo, useRef } from 'react';
import gsap from 'gsap';
import { seededRandom, useLineTransition, useTimedStates, useTrackedNodes, type LineRendererProps, type PreparedLine } from './lyricUnits';

// 傾斜: the line is split into one to four rows. One of them is set large and italic with its
// characters bobbing alternately up and down; the rest stay small and letter-spaced. Rows appear in
// the order they are sung, and each character pulses as its syllable lands.
// (Re-creates the idea of folia-major's Tilt mode.)

const ENTER = { opacity: 0 };
const EXIT = { opacity: 0, y: -16, '--line-blur': '6px' };
const ROW_LEAD = 0.25; // rows appear a little before their first syllable
const BOB = 14; // yPercent each tilt-row character sits above or below the baseline

interface TiltRow {
  units: number[];
  tilt: boolean;
  time: number;
  end: number;
}

interface TiltGlyph {
  char: string;
  time: number;
  end: number;
  row: number;
  bob: number;
}

function buildLayout(line: PreparedLine) {
  const random = seededRandom(line.time + 3);
  const total = line.units.reduce((sum, unit) => sum + unit.glyphs.length, 0);
  const rowCount = Math.min(line.units.length, total <= 6 ? 1 : total <= 14 ? 2 : total <= 26 ? 3 : 4);
  const target = total / Math.max(1, rowCount);

  const groups: number[][] = [[]];
  let sum = 0;
  line.units.forEach((unit, i) => {
    groups.at(-1)!.push(i);
    sum += unit.glyphs.length;
    if (groups.length < rowCount && sum >= target * groups.length && i < line.units.length - 1) groups.push([]);
  });

  const sizes = groups.map((units) => units.reduce((n, i) => n + line.units[i].glyphs.length, 0));
  const candidates = sizes.map((size, i) => (size >= 2 && size <= 10 ? i : -1)).filter((i) => i >= 0);
  const tiltIndex = candidates.length
    ? candidates[Math.floor(random() * candidates.length)]
    : sizes.indexOf(Math.min(...sizes));

  const rows: TiltRow[] = groups.map((units, r) => ({
    units,
    tilt: r === tiltIndex,
    time: line.units[units[0]].time - ROW_LEAD,
    end: line.units[units.at(-1)!].end,
  }));

  const glyphs: TiltGlyph[] = [];
  rows.forEach((row, r) => {
    let parity = 0;
    for (const i of row.units) {
      for (const glyph of line.units[i].glyphs) {
        glyphs.push({ ...glyph, row: r, bob: row.tilt ? (parity % 2 ? BOB : -BOB) : 0 });
        parity += 1;
      }
    }
  });
  return { rows, glyphs };
}

export function TiltLine({ line, leaving, onExited }: LineRendererProps) {
  const rootRef = useRef<HTMLDivElement | null>(null);
  const rowRefs = useRef<(HTMLDivElement | null)[]>([]);
  const glyphRefs = useRef<(HTMLSpanElement | null)[]>([]);
  const shownRef = useRef<boolean[]>([]);
  const track = useTrackedNodes();
  const layout = useMemo(() => buildLayout(line), [line]);

  useLineTransition(rootRef, leaving, onExited, ENTER, EXIT, line);

  // Shrink any row that would overflow the stage instead of letting it wrap.
  useLayoutEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    const fit = () => {
      const available = root.clientWidth * 0.94;
      rowRefs.current.forEach((row) => {
        if (!row) return;
        row.style.setProperty('--fit', '1');
        if (row.scrollWidth > available) row.style.setProperty('--fit', (available / row.scrollWidth).toFixed(3));
      });
    };
    fit();
    const resize = new ResizeObserver(fit);
    resize.observe(root);
    void document.fonts?.ready.then(fit);
    return () => resize.disconnect();
  }, [layout]);

  const rowGlyphs = (r: number) => layout.glyphs.flatMap((glyph, g) => (glyph.row === r && glyphRefs.current[g] ? [glyphRefs.current[g]!] : []));

  useTimedStates(layout.rows, !leaving, (r, state, initial) => {
    const row = rowRefs.current[r];
    if (!row) return;
    const glyphs = rowGlyphs(r);
    const bobs = layout.glyphs.filter((glyph) => glyph.row === r).map((glyph) => glyph.bob);
    if (state === 'waiting') {
      shownRef.current[r] = false;
      gsap.killTweensOf(row);
      const vars = { opacity: 0, y: 20, scale: layout.rows[r].tilt ? 0.92 : 1 };
      if (initial) {
        gsap.set(row, vars);
        gsap.set(glyphs, { opacity: 0, yPercent: (i: number) => bobs[i] * 2 });
      } else {
        gsap.to(row, { ...vars, duration: 0.3, ease: 'power2.out' });
      }
      return;
    }
    if (shownRef.current[r]) return;
    shownRef.current[r] = true;
    gsap.to(row, { opacity: 1, y: 0, scale: 1, duration: 0.6, ease: 'power2.out', overwrite: 'auto' });
    gsap.fromTo(glyphs, { opacity: 0, yPercent: (i: number) => bobs[i] * 2 }, {
      opacity: 1,
      yPercent: (i: number) => bobs[i],
      duration: 0.5,
      stagger: layout.rows[r].tilt ? 0.05 : 0.035,
      ease: 'power2.out',
      overwrite: 'auto',
    });
  });

  useTimedStates(layout.glyphs, !leaving, (g, state) => {
    const el = glyphRefs.current[g];
    if (!el) return;
    el.dataset.state = state;
    gsap.to(el, state === 'active'
      ? { scale: 1.22, duration: 0.12, ease: 'power2.out', overwrite: 'auto' }
      : { scale: 1, duration: 0.4, ease: 'power2.out', overwrite: 'auto' });
  });

  let glyphIndex = 0;
  return (
    <div ref={(node) => { rootRef.current = node; track(node); }} className="immersive-line tilt-line" aria-hidden={leaving || undefined}>
      {layout.rows.map((row, r) => (
        <div
          key={r}
          ref={(node) => { rowRefs.current[r] = node; track(node); }}
          className={`tilt-row${row.tilt ? ' tilt-row--tilt' : ''}`}
        >
          {row.units.map((unitIndex, k) => {
            const unit = line.units[unitIndex];
            return (
              <Fragment key={unitIndex}>
                {unit.glyphs.map((glyph) => {
                  const g = glyphIndex++;
                  return (
                    <span key={g} ref={(node) => { glyphRefs.current[g] = node; track(node); }} className="tilt-glyph">
                      {glyph.char}
                    </span>
                  );
                })}
                {unit.spaceAfter && k < row.units.length - 1 ? <span className="tilt-space" /> : null}
              </Fragment>
            );
          })}
        </div>
      ))}
    </div>
  );
}
