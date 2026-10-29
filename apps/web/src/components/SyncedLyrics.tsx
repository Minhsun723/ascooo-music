import { Fragment, useEffect, useLayoutEffect, useMemo, useRef, useState, type RefObject } from 'react';
import gsap from 'gsap';
import { activeIndex, splitBackground, withInterludes, type LyricLine, type LyricWord } from '../lib/lrc';
import { getAudio, getPlaybackTime } from '../store/player';

const USER_SCROLL_IDLE = 2600;
const WAVE_BEFORE = 2;
const WAVE_AFTER = 10;
const WAVE_STAGGER = 0.05;
const MAX_BLUR_DISTANCE = 5;
const BLUR_PER_LINE = 0.7;
const INTERLUDE_OUT = 0.45; // seconds the interlude dots spend shrinking away
const LINE_LOOKAHEAD = 0.15; // activeIndex switches lines this early

const prefersReducedMotion = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;

interface WordTimeline {
  tl: gsap.core.Timeline;
  base: number;
  index: number;
}

/**
 * One paused timeline per active line; the ticker scrubs it to the audio clock, so seeking just works.
 * `sung` lists the line's words in the order they're rendered, which `words` and `glows` follow.
 */
function buildWordTimeline(line: LyricLine, sung: LyricWord[], index: number, words: HTMLElement[], glows: HTMLElement[], reduce: boolean): WordTimeline {
  // A line sung before (seeking back) keeps its words' last inline state, and the tweens below
  // don't render until the playhead reaches them, so unsung words would show already lit.
  gsap.killTweensOf([...words, ...glows]);
  gsap.set([...words, ...glows], { '--p': 0, '--glow': 0, yPercent: 0, scale: 1 });

  // GSAP's default force3D lifts a word onto its own layer only while it moves, and every lift and
  // drop re-rasterizes the rest of the line, which costs more with each row the line wraps to.
  const tl = gsap.timeline({ paused: true, defaults: { force3D: false } });
  const base = Math.min(line.time, line.words?.[0]?.time ?? line.time);

  sung.forEach((word, index) => {
    const el = words[index];
    if (!el) return;
    const start = Math.max(0, word.time - base);
    const duration = Math.max(0.05, word.end - word.time);
    // The glow copy moves with its word, so the halo stays on it as it lifts and swells.
    const pair = glows[index] ? [el, glows[index]] : el;

    tl.fromTo(pair, { '--p': 0 }, { '--p': 1, duration, ease: 'none', immediateRender: false }, start);
    if (reduce) return;
    tl.fromTo(pair, { yPercent: 0 }, { yPercent: -6, duration: Math.max(0.4, duration), ease: 'power2.out', immediateRender: false }, start);

    // Held notes swell and glow, then settle back.
    if (duration >= 1 && word.text.trim().length <= 10) {
      const rise = duration * 0.55;
      tl.fromTo(pair, { '--glow': 0, scale: 1 }, { '--glow': 1, scale: 1.06, duration: rise, ease: 'sine.out', immediateRender: false }, start);
      tl.fromTo(pair, { '--glow': 1, scale: 1.06 }, { '--glow': 0, scale: 1, duration: duration - rise + 0.3, ease: 'sine.inOut', immediateRender: false }, start + rise);
    }
  });

  return { tl, base, index };
}

function splitTrailingSpace(text: string) {
  const body = text.trimEnd();
  return [body, text.slice(body.length)] as const;
}

/** The sung words, or with `glow` their copy underneath; both wrap the same, so the glow lines up. */
function timedWords(words: LyricWord[], glow = false) {
  return words.map((word, wordIndex) => {
    const [body, trailing] = splitTrailingSpace(word.text);
    return (
      <Fragment key={`${word.time}-${wordIndex}`}>
        <span className={glow ? undefined : 'lyrics-word'}>{body}</span>{trailing}
      </Fragment>
    );
  });
}

/** A row of sung words; on the active line, the glow copy goes underneath. */
function timedRow(words: LyricWord[], active: boolean, className = 'lyrics-lines__text lyrics-lines__text--timed') {
  return (
    <span className={className} aria-hidden="true">
      {active ? <span className="lyrics-lines__glow">{timedWords(words, true)}</span> : null}
      {timedWords(words)}
    </span>
  );
}

export function SyncedLyrics({ lines: sourceLines, panelRef, onSeek }: {
  lines: LyricLine[];
  panelRef: RefObject<HTMLDivElement | null>;
  onSeek: (time: number) => void;
}) {
  const lines = useMemo(() => withInterludes(sourceLines), [sourceLines]);
  const vocals = useMemo(() => lines.map((line) => splitBackground(line.words ?? [])), [lines]);
  const [active, setActive] = useState(() => activeIndex(lines, getPlaybackTime()));
  const activeRef = useRef(active);
  const lineRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const wordTimelineRef = useRef<WordTimeline | null>(null);
  const scrollTweenRef = useRef<gsap.core.Tween | null>(null);
  const waveTweensRef = useRef<(gsap.core.Tween | undefined)[]>([]);
  const userScrollTimerRef = useRef(0);
  const userScrollingRef = useRef(false);
  const hasFollowedRef = useRef(false);

  const targetScrollTop = (panel: HTMLElement, index: number) => {
    const line = index >= 0 ? lineRefs.current[index] : null;
    if (!line) return 0;
    const panelRect = panel.getBoundingClientRect();
    const lineRect = line.getBoundingClientRect();
    const lineY = Number(gsap.getProperty(line, 'y')) || 0;
    const top = panel.scrollTop + lineRect.top - lineY - panelRect.top - (panel.clientHeight - lineRect.height) / 2;
    return Math.max(0, Math.min(top, panel.scrollHeight - panel.clientHeight));
  };

  const settleLine = (el: HTMLElement, index: number) => {
    waveTweensRef.current[index]?.kill();
    waveTweensRef.current[index] = undefined;
    gsap.set(el, { y: 0 });
  };

  const smoothScrollTo = (panel: HTMLElement, top: number) => {
    scrollTweenRef.current?.kill();
    const proxy = { top: panel.scrollTop };
    scrollTweenRef.current = gsap.to(proxy, {
      top,
      duration: 0.8,
      ease: 'power3.inOut',
      onUpdate: () => { panel.scrollTop = proxy.top; },
    });
  };

  /**
   * Interludes and background vocals take room in the list only on the active row. Set here rather
   * than rendered, so `follow` can measure the rows before the layout changes.
   */
  const openActive = (index: number) => {
    lineRefs.current.forEach((el, i) => el?.toggleAttribute('data-open', i === index));
  };

  /**
   * Jump the scroll position (after `relayout`, if any), then let each line glide back from where
   * it was on screen with a staggered wave, so layout changes move as smoothly as scrolling does.
   */
  const follow = (immediate: boolean, relayout?: () => void) => {
    const panel = panelRef.current;
    if (!panel || userScrollingRef.current) {
      relayout?.();
      return;
    }
    scrollTweenRef.current?.kill();

    const before = immediate ? [] : lineRefs.current.map((el) => el?.getBoundingClientRect().top ?? 0);
    relayout?.();
    const index = activeRef.current;
    const previous = panel.scrollTop;
    panel.scrollTop = targetScrollTop(panel, index);
    const shift = panel.scrollTop - previous;
    if (immediate || Math.abs(shift) > panel.clientHeight * 1.5) {
      lineRefs.current.forEach((el, i) => { if (el) settleLine(el, i); });
      return;
    }

    const anchor = Math.max(0, index);
    lineRefs.current.forEach((el, i) => {
      if (!el) return;
      const offset = i - anchor;
      // Interlude rows pop in and out in place; collapsed ones measure at 0 and would fly in.
      if (lines[i]?.interlude || offset < -WAVE_BEFORE - 4 || offset > WAVE_AFTER + 4) {
        settleLine(el, i);
        return;
      }
      const delta = before[i] - el.getBoundingClientRect().top;
      if (Math.abs(delta) < 1) return;
      const currentY = Number(gsap.getProperty(el, 'y')) || 0;
      // The previous wave must be killed by its handle: neither 'auto' overwrite nor
      // killTweensOf(el, 'y') stops a fromTo still in its delay, which then stays parked on its
      // start offset for good, leaving lines overlapping or a gap where the active line should be.
      waveTweensRef.current[i]?.kill();
      waveTweensRef.current[i] = gsap.fromTo(el, { y: currentY + delta }, {
        y: 0,
        duration: 0.9,
        ease: 'power3.out',
        delay: gsap.utils.clamp(0, WAVE_BEFORE + WAVE_AFTER, offset + WAVE_BEFORE) * WAVE_STAGGER,
      });
    });
  };

  const endUserScroll = () => {
    window.clearTimeout(userScrollTimerRef.current);
    userScrollingRef.current = false;
    panelRef.current?.removeAttribute('data-user-scrolling');
  };

  useLayoutEffect(() => {
    lineRefs.current.length = lines.length;
    waveTweensRef.current.forEach((tween) => tween?.kill());
    waveTweensRef.current = [];
    hasFollowedRef.current = false;
  }, [lines]);

  // Frame-accurate clock: the store only publishes currentTime every 250ms, and some browsers step it coarsely.
  useEffect(() => {
    const audio = getAudio();
    if (!audio) return;
    const tick = () => {
      const time = getPlaybackTime();
      const next = activeIndex(lines, time);
      if (next !== activeRef.current) {
        activeRef.current = next;
        setActive(next);
      }
      const words = wordTimelineRef.current;
      // Until React commits the new line, the timeline still belongs to the old one; scrubbing it
      // to the new time would flash that line fully lit or dark for a frame.
      if (words && words.index === next) words.tl.time(gsap.utils.clamp(0, words.tl.duration(), time - words.base));
      // Interlude dots light up one by one across the gap, then shrink away just before the next line.
      const row = lines[next];
      const rowEl = lineRefs.current[next];
      if (row?.interlude && row.end !== undefined && rowEl) {
        const outAt = row.end - LINE_LOOKAHEAD - INTERLUDE_OUT;
        rowEl.style.setProperty('--p', String(gsap.utils.clamp(0, 1, (time - row.time) / Math.max(0.1, outAt - row.time))));
        rowEl.style.setProperty('--fade', String(gsap.utils.clamp(0, 1, 1 - (time - outAt) / INTERLUDE_OUT)));
      }
    };
    tick();
    gsap.ticker.add(tick);
    return () => gsap.ticker.remove(tick);
  }, [lines]);

  // Line change: depth (scale + blur by distance) and the scroll wave.
  useLayoutEffect(() => {
    const reduce = prefersReducedMotion();
    lineRefs.current.forEach((el, i) => {
      if (!el) return;
      const distance = active < 0 ? i + 1 : Math.abs(i - active);
      // Set, not tweened: a changing blur radius re-rasterizes every line each frame, which drops
      // frames on large high-DPI screens. One step of 0.7px is too small to notice jumping.
      gsap.set(el, { '--blur': `${reduce ? 0 : Math.min(distance, MAX_BLUR_DISTANCE) * BLUR_PER_LINE}px` });
      const text = el.firstElementChild;
      const scale = i === active || reduce ? 1 : 0.95;
      if (distance > WAVE_AFTER + 4) {
        if (text) gsap.set(text, { scale });
        return;
      }
      if (text) gsap.to(text, { scale, duration: i === active ? 0.7 : 0.5, ease: i === active ? 'back.out(1.6)' : 'power2.out', overwrite: 'auto' });
    });

    follow(!hasFollowedRef.current || reduce, () => openActive(active));
    hasFollowedRef.current = true;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, lines]);

  // Word-by-word fill for TTML lines.
  useLayoutEffect(() => {
    const line = lines[active];
    const el = lineRefs.current[active];
    if (!line?.words?.length || !el) return;
    const words = Array.from(el.querySelectorAll<HTMLElement>('.lyrics-word'));
    const glows = Array.from(el.querySelectorAll<HTMLElement>('.lyrics-lines__glow > span'));
    const { lead, background } = vocals[active];
    const built = buildWordTimeline(line, [...lead, ...background], active, words, glows, prefersReducedMotion());
    built.tl.time(gsap.utils.clamp(0, built.tl.duration(), getPlaybackTime() - built.base));
    wordTimelineRef.current = built;

    return () => {
      built.tl.kill();
      if (wordTimelineRef.current === built) wordTimelineRef.current = null;
      gsap.to(words, { yPercent: 0, scale: 1, '--glow': 0, duration: 0.5, ease: 'power2.out', overwrite: true, force3D: false });
    };
  }, [active, lines, vocals]);

  // Pause auto-follow while the listener scrolls by hand; drift back after a moment.
  useEffect(() => {
    const panel = panelRef.current;
    if (!panel) return;
    const onUserScroll = () => {
      scrollTweenRef.current?.kill();
      userScrollingRef.current = true;
      panel.setAttribute('data-user-scrolling', 'true');
      window.clearTimeout(userScrollTimerRef.current);
      userScrollTimerRef.current = window.setTimeout(() => {
        endUserScroll();
        // While paused, leave the lyrics where the listener put them.
        if (getAudio()?.paused === false) smoothScrollTo(panel, targetScrollTop(panel, activeRef.current));
      }, USER_SCROLL_IDLE);
    };
    // Resuming playback brings the active line back into view.
    const onPlay = () => {
      endUserScroll();
      smoothScrollTo(panel, targetScrollTop(panel, activeRef.current));
    };
    const audio = getAudio();
    const resize = new ResizeObserver(() => follow(true));
    resize.observe(panel);
    panel.addEventListener('wheel', onUserScroll, { passive: true });
    panel.addEventListener('touchmove', onUserScroll, { passive: true });
    audio?.addEventListener('play', onPlay);
    return () => {
      resize.disconnect();
      panel.removeEventListener('wheel', onUserScroll);
      panel.removeEventListener('touchmove', onUserScroll);
      audio?.removeEventListener('play', onPlay);
      window.clearTimeout(userScrollTimerRef.current);
      scrollTweenRef.current?.kill();
      gsap.killTweensOf(lineRefs.current.filter(Boolean));
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [panelRef]);

  return (
    <div className="lyrics-lines">
      {lines.map((line, index) => (
        <button
          type="button"
          key={`${line.time}-${index}`}
          ref={(node) => { lineRefs.current[index] = node; }}
          className={[line.interlude && 'lyrics-lines__interlude', index === active && 'is-active'].filter(Boolean).join(' ')}
          aria-label={line.interlude ? '間奏' : line.text || '♪'}
          // Don't take focus on click, so Space keeps toggling playback instead of re-seeking.
          onMouseDown={(event) => event.preventDefault()}
          onClick={() => { endUserScroll(); onSeek(line.time); }}
        >
          {line.interlude ? (
            <span className="lyrics-lines__text lyrics-interlude" aria-hidden="true">
              <span className="lyrics-interlude__dots"><i /><i /><i /></span>
            </span>
          ) : line.words?.length ? (
            <>
              {timedRow(vocals[index].lead, index === active)}
              {vocals[index].background.length
                ? timedRow(vocals[index].background, index === active, 'lyrics-lines__text lyrics-lines__text--timed lyrics-lines__bg')
                : null}
            </>
          ) : (
            <span className="lyrics-lines__text" aria-hidden="true">{line.text || '♪'}</span>
          )}
        </button>
      ))}
    </div>
  );
}
