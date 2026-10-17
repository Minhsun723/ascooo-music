import { useCallback, useEffect, useLayoutEffect, useRef, type RefObject } from 'react';
import gsap from 'gsap';
import type { LyricLine } from '../lib/lrc';
import { getAudio } from '../store/player';

// Timing and lifecycle shared by every immersive lyric renderer: lines are cut into word-sized
// units (and glyphs) with their own start/end times, and renderers react to per-unit states.

export const LOOKAHEAD = 0.1; // light words a hair before the vocal so motion lands on the beat
const TTML_HOLD = 1.2; // seconds a finished TTML line lingers before the interlude
const LRC_HOLD = 5; // LRC has no end times; give up on a line after this much silence
const LRC_SECONDS_PER_CHAR = 0.32; // pace of the synthesized reveal for LRC lines

export type UnitState = 'waiting' | 'active' | 'passed';

export interface TimedGlyph {
  char: string;
  time: number;
  end: number;
}

export interface TimedUnit {
  text: string;
  time: number;
  end: number;
  spaceAfter: boolean;
  glyphs: TimedGlyph[];
}

export interface PreparedLine {
  time: number;
  units: TimedUnit[];
  hideAt: number;
  cjk: boolean;
}

/** What the stage hands every single-line renderer. */
export interface LineRendererProps {
  line: PreparedLine;
  leaving: boolean;
  onExited: () => void;
}

const CJK = /[\u3040-\u30ff\u3400-\u9fff\uac00-\ud7af]/;

/** Deterministic per line, so a lyric keeps its composition across rerenders and replays. */
export function seededRandom(seed: number) {
  let state = Math.floor(seed * 1000) >>> 0 || 1;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

interface Glyph extends TimedGlyph {
  offset: number; // UTF-16 index into the line text, to line up with Intl.Segmenter
}

/** Spread each source word's span evenly over its glyphs, so display units can cut anywhere. */
function glyphTimings(line: LyricLine, nextTime: number | undefined) {
  const glyphs: Glyph[] = [];
  let text = '';
  const push = (value: string, start: number, end: number) => {
    const chars = Array.from(value);
    chars.forEach((char, index) => {
      glyphs.push({
        char,
        offset: text.length,
        time: start + (end - start) * index / chars.length,
        end: start + (end - start) * (index + 1) / chars.length,
      });
      text += char;
    });
  };

  if (line.words?.length) {
    for (const word of line.words) push(word.text, word.time, word.end);
  } else {
    const visible = Array.from(line.text).filter((char) => char.trim()).length || 1;
    const gap = (nextTime ?? line.time + 8) - line.time;
    push(line.text, line.time, line.time + Math.max(0.3, Math.min(gap * 0.75, visible * LRC_SECONDS_PER_CHAR)));
  }
  return { text, glyphs };
}

const segmenter = typeof Intl !== 'undefined' && 'Segmenter' in Intl
  ? new Intl.Segmenter(undefined, { granularity: 'word' })
  : null;

/** Word-sized ranges with punctuation glued to its neighbour; whitespace only separates. */
function unitRanges(text: string) {
  const pieces = segmenter
    ? Array.from(segmenter.segment(text), (s) => ({ start: s.index, end: s.index + s.segment.length, space: !s.segment.trim(), word: s.isWordLike ?? true }))
    : Array.from(text.matchAll(/\s+|\S+/g), (m) => ({ start: m.index, end: m.index + m[0].length, space: !m[0].trim(), word: true }));

  const ranges: { start: number; end: number; spaceAfter: boolean }[] = [];
  let afterSpace = true;
  let glueNext = false;
  for (const piece of pieces) {
    if (piece.space) {
      const previous = ranges.at(-1);
      if (previous) previous.spaceAfter = true;
      afterSpace = true;
      glueNext = false;
      continue;
    }
    const previous = ranges.at(-1);
    if (previous && (glueNext || (!piece.word && !afterSpace))) {
      previous.end = piece.end;
      glueNext = glueNext && !piece.word;
    } else {
      ranges.push({ start: piece.start, end: piece.end, spaceAfter: false });
      glueNext = !piece.word; // opening brackets and quotes pull the next word in
    }
    afterSpace = false;
  }
  return ranges;
}

export function prepareLine(line: LyricLine, nextTime: number | undefined): PreparedLine {
  const { text, glyphs } = glyphTimings(line, nextTime);
  const units: TimedUnit[] = [];
  for (const range of unitRanges(text)) {
    const timed = glyphs.filter((glyph) => glyph.offset >= range.start && glyph.offset < range.end && glyph.char.trim());
    if (!timed.length) continue;
    units.push({
      text: text.slice(range.start, range.end),
      time: timed[0].time,
      end: timed.at(-1)!.end,
      spaceAfter: range.spaceAfter,
      glyphs: timed.map(({ char, time, end }) => ({ char, time, end })),
    });
  }

  const sungUntil = units.at(-1)?.end ?? line.time;
  return {
    time: line.time,
    units,
    hideAt: line.words?.length ? Math.max(line.end ?? 0, sungUntil) + TTML_HOLD : sungUntil + LRC_HOLD,
    cjk: CJK.test(text),
  };
}

export const stateAt = (time: number, item: { time: number; end: number }): UnitState =>
  time < item.time - LOOKAHEAD ? 'waiting' : time <= item.end ? 'active' : 'passed';

/**
 * Follow the audio clock every frame and report state changes per item. Setup runs before paint:
 * items start as 'waiting' (or, with initial 'actual', in their real state) with `initial` set,
 * so renderers can pose them without tweening. `onProgress` fires every frame while active.
 */
export function useTimedStates(
  items: readonly { time: number; end: number }[],
  enabled: boolean,
  onState: (index: number, state: UnitState, initial: boolean) => void,
  onProgress?: (index: number, progress: number) => void,
  initial: 'waiting' | 'actual' = 'waiting',
) {
  const handlers = useRef({ onState, onProgress });
  handlers.current = { onState, onProgress };

  useLayoutEffect(() => {
    if (!enabled) return;
    const audio = getAudio();
    const start = audio?.currentTime ?? 0;
    const states = items.map((item) => initial === 'actual' ? stateAt(start, item) : 'waiting');
    states.forEach((state, i) => handlers.current.onState(i, state, true));

    const tick = () => {
      const time = audio?.currentTime ?? 0;
      items.forEach((item, i) => {
        const state = stateAt(time, item);
        if (state === 'active') {
          handlers.current.onProgress?.(i, gsap.utils.clamp(0, 1, (time - item.time) / Math.max(0.05, item.end - item.time)));
        }
        if (state === states[i]) return;
        states[i] = state;
        handlers.current.onState(i, state, false);
      });
    };
    tick();
    gsap.ticker.add(tick);
    return () => gsap.ticker.remove(tick);
  }, [items, enabled, initial]);
}

/** Whole-line entrance, and an exit that reports back when done so the stage can drop the line. */
export function useLineTransition(
  rootRef: RefObject<HTMLElement | null>,
  leaving: boolean,
  onExited: () => void,
  enter: gsap.TweenVars,
  exit: gsap.TweenVars,
  resetKey: unknown,
) {
  const exitedRef = useRef(onExited);
  exitedRef.current = onExited;

  useLayoutEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    if (leaving) {
      const tween = gsap.to(root, { ...exit, duration: 0.35, ease: 'power2.in', overwrite: 'auto', onComplete: () => exitedRef.current() });
      return () => { tween.kill(); };
    }
    gsap.fromTo(root, enter, {
      opacity: 1, x: 0, y: 0, z: 0, scale: 1, '--line-blur': '0px', duration: 0.5, ease: 'power2.out', overwrite: 'auto',
    });
  // enter/exit come from static style tables; resetKey covers a new line in the same slot.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [leaving, resetKey]);
}

/**
 * Callback ref that remembers every node it sees and kills their tweens on unmount —
 * React has already cleared element refs by the time unmount cleanups run.
 */
export function useTrackedNodes() {
  const nodes = useRef(new Set<Element>());
  useEffect(() => {
    const set = nodes.current;
    return () => { gsap.killTweensOf([...set]); };
  }, []);
  return useCallback((node: Element | null) => { if (node) nodes.current.add(node); }, []);
}
