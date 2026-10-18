import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ComponentType } from 'react';
import gsap from 'gsap';
import { activeIndex, type LyricLine } from '../lib/lrc';
import { getAudio, getPlaybackTime } from '../store/player';
import type { ImmersiveStyle } from '../store/preferences';
import { CappellaLyrics } from './ImmersiveCappella';
import { CladdaghLine } from './ImmersiveCladdagh';
import { PartitaLine } from './ImmersivePartita';
import { TiltLine } from './ImmersiveTilt';
import { IMMERSIVE_STYLE_DEFINITIONS, REDUCED_STYLE, type StyleDefinition, type UnitLayout } from './immersiveStyles';
import {
  prepareLine,
  seededRandom,
  useLineTransition,
  useTimedStates,
  useTrackedNodes,
  type LineRendererProps,
} from './lyricUnits';

const SPACE_GAP = 0.3; // em between units the source separated with whitespace

const prefersReducedMotion = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;

/** A style that shows one line at a time on the shared stage. */
interface StageEntry {
  Line: ComponentType<LineRendererProps & { style?: StyleDefinition }>;
  style?: StyleDefinition;
  float: boolean;
}

/** Styles that take over the whole panel instead of showing one line at a time. */
const FULL_RENDERERS: Partial<Record<ImmersiveStyle, ComponentType<{ lines: LyricLine[]; reduce: boolean; onSeek: (time: number) => void }>>> = {
  cappella: CappellaLyrics,
};

const LINE_RENDERERS: Partial<Record<ImmersiveStyle, StageEntry>> = {
  partita: { Line: PartitaLine, float: true },
  tilt: { Line: TiltLine, float: true },
  claddagh: { Line: CladdaghLine, float: false },
};

function resolveStage(styleName: ImmersiveStyle, reduce: boolean): StageEntry {
  if (reduce) return { Line: WordLine, style: REDUCED_STYLE, float: false };
  const custom = LINE_RENDERERS[styleName];
  if (custom) return custom;
  const style = (IMMERSIVE_STYLE_DEFINITIONS as Partial<Record<ImmersiveStyle, StyleDefinition>>)[styleName] ?? IMMERSIVE_STYLE_DEFINITIONS.scatter;
  return { Line: WordLine, style, float: style.float };
}

/** A line whose words animate through a StyleDefinition's waiting / active / passed poses. */
function WordLine({ line, leaving, onExited, style = REDUCED_STYLE }: LineRendererProps & { style?: StyleDefinition }) {
  const rootRef = useRef<HTMLDivElement | null>(null);
  const unitRefs = useRef<(HTMLSpanElement | null)[]>([]);
  const track = useTrackedNodes();

  const { justify, align, layouts } = useMemo(() => {
    const random = seededRandom(line.time + 1);
    const placement = style.layout(random);
    const unitLayouts: UnitLayout[] = line.units.map(() => ({ x: 0, y: 0, rotate: 0, scale: 1, fromX: 0, fromY: 0, drift: 0, ...style.unit(random) }));
    return { ...placement, layouts: unitLayouts };
  }, [line, style]);

  // Leave room for each word's swell and its neighbour's offset, so nothing collides at peak scale.
  useLayoutEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    unitRefs.current.length = line.units.length;
    const space = () => {
      const fontSize = parseFloat(getComputedStyle(root).fontSize) || 16;
      const widths = unitRefs.current.map((el) => el?.offsetWidth ?? 0);
      line.units.forEach((unit, i) => {
        const el = unitRefs.current[i];
        const layout = layouts[i];
        const next = layouts[i + 1];
        if (!el) return;
        if (!next) {
          el.style.marginRight = '0px';
          return;
        }
        const whileThisSings = widths[i] * (style.peakScale(layout) - 1) / 2;
        const whileNextSings = widths[i] * (style.restScale(layout) - 1) / 2 + widths[i + 1] * (style.peakScale(next) - 1) / 2;
        const overlap = Math.max(whileThisSings, whileNextSings) + layout.x - next.x;
        const gap = fontSize * (unit.spaceAfter ? SPACE_GAP : style.gap);
        // The natural gap rides on top of the overlap, which also absorbs spring overshoot.
        el.style.marginRight = `${Math.max(gap, overlap + gap).toFixed(1)}px`;
      });
    };
    space();
    const resize = new ResizeObserver(space);
    resize.observe(root);
    void document.fonts?.ready.then(space);
    return () => resize.disconnect();
  }, [line, layouts, style]);

  useLineTransition(rootRef, leaving, onExited, style.enter, style.exit, line);

  useTimedStates(line.units, !leaving, (i, state, initial) => {
    const el = unitRefs.current[i];
    const layout = layouts[i];
    if (!el || !layout) return;
    gsap.killTweensOf(el);
    if (state === 'waiting') {
      el.style.setProperty('--p', '0');
      if (initial) gsap.set(el, style.waiting(layout));
      else gsap.to(el, { ...style.waiting(layout), duration: 0.35, ease: 'power2.out' });
    } else if (state === 'active') {
      style.active(el, layout);
    } else {
      el.style.setProperty('--p', '1');
      style.passed(el, layout);
    }
  }, (i, progress) => unitRefs.current[i]?.style.setProperty('--p', progress.toFixed(3)));

  return (
    <div
      ref={(node) => { rootRef.current = node; track(node); }}
      className="immersive-line"
      style={{ justifyContent: justify, alignContent: align }}
      aria-hidden={leaving || undefined}
    >
      {line.units.map((unit, i) => (
        <span key={`${unit.time}-${i}`} ref={(node) => { unitRefs.current[i] = node; track(node); }} className="immersive-word">
          <span className="immersive-word__fill">{unit.text}</span>
        </span>
      ))}
    </div>
  );
}

/** One line at a time: picks the shown line from the clock, fades old lines out, previews the next. */
function ImmersiveStage({ lines, entry }: { lines: LyricLine[]; entry: StageEntry }) {
  const prepared = useMemo(() => lines.map((line, i) => prepareLine(line, lines[i + 1]?.time)), [lines]);

  const locate = useCallback((time: number) => {
    const raw = activeIndex(lines, time);
    const line = prepared[raw];
    const shown = line && line.units.length && time <= line.hideAt ? raw : -1;
    let upcoming = raw + 1;
    while (upcoming < lines.length && !lines[upcoming].text.trim()) upcoming += 1;
    return { shown, upcoming };
  }, [lines, prepared]);

  const [view, setView] = useState(() => locate(getPlaybackTime()));
  const [leaving, setLeaving] = useState<number[]>([]);
  const viewRef = useRef(view);
  const floatRef = useRef<HTMLDivElement | null>(null);

  useLayoutEffect(() => {
    const next = locate(getPlaybackTime());
    viewRef.current = next;
    setView(next);
    setLeaving([]);
  }, [locate]);

  useEffect(() => {
    const audio = getAudio();
    if (!audio) return;
    const tick = () => {
      const next = locate(getPlaybackTime());
      const current = viewRef.current;
      if (next.shown === current.shown && next.upcoming === current.upcoming) return;
      viewRef.current = next;
      if (next.shown !== current.shown) {
        // Keep at most two lines fading out, so fast seeking can't pile them up.
        setLeaving((list) => {
          const rest = list.filter((i) => i !== next.shown && i !== current.shown);
          return (current.shown >= 0 ? [...rest, current.shown] : rest).slice(-2);
        });
      }
      setView(next);
    };
    gsap.ticker.add(tick);
    return () => gsap.ticker.remove(tick);
  }, [locate]);

  // A slow breath on the whole stage, so it never sits perfectly still between words.
  useEffect(() => {
    const el = floatRef.current;
    if (!el || !entry.float) return;
    const tween = gsap.fromTo(el, { y: 10 }, { y: -10, duration: 3.6, ease: 'sine.inOut', yoyo: true, repeat: -1 });
    return () => { tween.kill(); gsap.set(el, { y: 0 }); };
  }, [entry]);

  const finishExit = useCallback((index: number) => setLeaving((list) => list.filter((i) => i !== index)), []);

  // One keyed list, so a line moving from "shown" to "leaving" keeps its DOM and current pose.
  const rendered = [
    ...leaving.map((index) => ({ index, leaving: true })),
    ...(view.shown >= 0 ? [{ index: view.shown, leaving: false }] : []),
  ].filter(({ index }) => prepared[index]);
  const upcomingText = lines[view.upcoming]?.text ?? '';
  const { Line } = entry;

  return (
    <>
      <div ref={floatRef} className="immersive-lyrics__stage">
        {rendered.map(({ index, leaving: isLeaving }) => (
          <Line
            key={index}
            line={prepared[index]}
            style={entry.style}
            leaving={isLeaving}
            onExited={() => finishExit(index)}
          />
        ))}
        {view.shown < 0 ? <div className="immersive-lyrics__rest" aria-hidden="true"><span /><span /><span /></div> : null}
      </div>
      <p key={view.upcoming} className="immersive-lyrics__next" aria-hidden="true">{upcomingText}</p>
    </>
  );
}

export function ImmersiveLyrics({ lines, styleName, onSeek }: { lines: LyricLine[]; styleName: ImmersiveStyle; onSeek: (time: number) => void }) {
  const reduce = useMemo(prefersReducedMotion, []);
  const entry = useMemo(() => resolveStage(styleName, reduce), [styleName, reduce]);
  const Full = FULL_RENDERERS[styleName];

  return (
    <div className="immersive-lyrics" data-style={styleName}>
      {Full ? <Full lines={lines} reduce={reduce} onSeek={onSeek} /> : <ImmersiveStage lines={lines} entry={entry} />}
    </div>
  );
}
