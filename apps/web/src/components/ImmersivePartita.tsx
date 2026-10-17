import { useMemo, useRef, type CSSProperties } from 'react';
import gsap from 'gsap';
import { seededRandom, useLineTransition, useTimedStates, useTrackedNodes, type LineRendererProps, type PreparedLine } from './lyricUnits';

// 雲階: the line is cut into short chunks laid out as a staircase of columns. Each chunk owns an
// L-shaped guide line that draws in under it, in the cover's accent, while it is being sung.
// (Re-creates the idea of folia-major's Partita mode.)

const ENTER = { opacity: 0, y: 24, '--line-blur': '6px' };
const EXIT = { opacity: 0, y: -24, '--line-blur': '10px' };
const ENDS_PHRASE = /[,，、。.!！?？;；:：]$/;

interface WordPose {
  x: number;
  y: number;
  rotate: number;
  drift: number;
}

function buildLayout(line: PreparedLine) {
  const random = seededRandom(line.time + 7);
  const target = line.cjk ? 5 : 11;

  const chunks: number[][] = [];
  let current: number[] = [];
  let count = 0;
  line.units.forEach((unit, i) => {
    current.push(i);
    count += unit.glyphs.length;
    const last = i === line.units.length - 1;
    if (!last && (count >= target || (ENDS_PHRASE.test(unit.text) && count >= target / 2))) {
      chunks.push(current);
      current = [];
      count = 0;
    }
  });
  if (current.length) chunks.push(current);
  // A lone glyph reads oddly on a step of its own; fold it back into the chunk before it.
  const tail = chunks.at(-1);
  if (chunks.length > 1 && tail && tail.reduce((sum, i) => sum + line.units[i].glyphs.length, 0) <= 1) {
    chunks[chunks.length - 2].push(...chunks.pop()!);
  }

  const perColumn = chunks.length <= 2 ? 1 : chunks.length <= 6 ? 2 : 3;
  const columns: number[][] = [];
  for (let i = 0; i < chunks.length; i += perColumn) columns.push(chunks.slice(i, i + perColumn).map((_, j) => i + j));

  const descending = random() < 0.65;
  const guides = chunks.map(() => (random() < 0.5 ? 'left' : 'right'));
  const poses: WordPose[] = line.units.map(() => ({
    x: (random() - 0.5) * 12,
    y: (random() - 0.5) * 12,
    rotate: (random() - 0.5) * 6,
    drift: (random() - 0.5) * 16,
  }));
  const chunkTimes = chunks.map((units) => ({ time: line.units[units[0]].time, end: line.units[units.at(-1)!].end }));

  return { chunks, columns, descending, guides, poses, chunkTimes };
}

export function PartitaLine({ line, leaving, onExited }: LineRendererProps) {
  const rootRef = useRef<HTMLDivElement | null>(null);
  const wordRefs = useRef<(HTMLSpanElement | null)[]>([]);
  const chunkRefs = useRef<(HTMLDivElement | null)[]>([]);
  const track = useTrackedNodes();
  const layout = useMemo(() => buildLayout(line), [line]);

  useLineTransition(rootRef, leaving, onExited, ENTER, EXIT, line);

  useTimedStates(line.units, !leaving, (i, state, initial) => {
    const el = wordRefs.current[i];
    const pose = layout.poses[i];
    if (!el || !pose) return;
    gsap.killTweensOf(el);
    if (state === 'waiting') {
      const vars = { opacity: 0.2, x: pose.x, y: pose.y, scale: 0.94, rotation: pose.rotate, '--blur': '3px', '--glow': 0 };
      if (initial) gsap.set(el, vars);
      else gsap.to(el, { ...vars, duration: 0.35, ease: 'power2.out' });
    } else if (state === 'active') {
      gsap.to(el, { opacity: 1, scale: 1.14, rotation: pose.rotate, '--blur': '0px', '--glow': 1, duration: 0.5, ease: 'back.out(1.6)' });
    } else {
      gsap.to(el, { opacity: 0.82, scale: 1, '--blur': '0px', '--glow': 0, duration: 0.5, ease: 'power2.out' });
      gsap.to(el, { rotation: pose.rotate + pose.drift, duration: 4, ease: 'none' });
    }
  });

  // The guide lines are pure CSS transitions keyed off the chunk's state.
  useTimedStates(layout.chunkTimes, !leaving, (i, state) => {
    const el = chunkRefs.current[i];
    if (el) el.dataset.state = state;
  });

  return (
    <div ref={(node) => { rootRef.current = node; track(node); }} className="immersive-line partita-line" aria-hidden={leaving || undefined}>
      {layout.columns.map((column, c) => (
        <div
          key={c}
          className="partita-column"
          style={{ '--step': layout.descending ? c : layout.columns.length - 1 - c } as CSSProperties}
        >
          {column.map((chunkIndex, row) => (
            <div
              key={chunkIndex}
              ref={(node) => { chunkRefs.current[chunkIndex] = node; }}
              className="partita-chunk"
              data-guide={layout.guides[chunkIndex]}
              data-state="waiting"
              style={{ '--indent': row % 2 } as CSSProperties}
            >
              {layout.chunks[chunkIndex].map((unitIndex, k, units) => {
                const unit = line.units[unitIndex];
                const lastInChunk = k === units.length - 1;
                return (
                  <span
                    key={unitIndex}
                    ref={(node) => { wordRefs.current[unitIndex] = node; track(node); }}
                    className="immersive-word"
                    style={{ marginRight: lastInChunk ? 0 : unit.spaceAfter ? '.38em' : '.2em' }}
                  >
                    <span className="immersive-word__fill">{unit.text}</span>
                  </span>
                );
              })}
              <span className="partita-guide" aria-hidden="true" />
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}
