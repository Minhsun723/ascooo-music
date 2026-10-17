import { Fragment, useEffect, useLayoutEffect, useRef, useState, type RefObject } from 'react';
import gsap from 'gsap';
import { activeIndex, type LyricLine } from '../lib/lrc';
import { getAudio } from '../store/player';

const USER_SCROLL_IDLE = 2600;
const WAVE_BEFORE = 2;
const WAVE_AFTER = 10;
const WAVE_STAGGER = 0.05;
const MAX_BLUR_DISTANCE = 5;
const BLUR_PER_LINE = 0.7;

const prefersReducedMotion = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;

interface WordTimeline {
  tl: gsap.core.Timeline;
  base: number;
}

/** One paused timeline per active line; the ticker scrubs it to the audio clock, so seeking just works. */
function buildWordTimeline(line: LyricLine, words: HTMLElement[], reduce: boolean): WordTimeline {
  const tl = gsap.timeline({ paused: true });
  const base = Math.min(line.time, line.words?.[0]?.time ?? line.time);

  line.words?.forEach((word, index) => {
    const el = words[index];
    if (!el) return;
    const start = Math.max(0, word.time - base);
    const duration = Math.max(0.05, word.end - word.time);

    tl.fromTo(el, { '--p': 0 }, { '--p': 1, duration, ease: 'none', immediateRender: false }, start);
    if (reduce) return;
    tl.fromTo(el, { yPercent: 0 }, { yPercent: -6, duration: Math.max(0.4, duration), ease: 'power2.out', immediateRender: false }, start);

    // Held notes swell and glow, then settle back.
    if (duration >= 1 && word.text.trim().length <= 10) {
      const rise = duration * 0.55;
      tl.fromTo(el, { '--glow': 0, scale: 1 }, { '--glow': 1, scale: 1.06, duration: rise, ease: 'sine.out', immediateRender: false }, start);
      tl.fromTo(el, { '--glow': 1, scale: 1.06 }, { '--glow': 0, scale: 1, duration: duration - rise + 0.3, ease: 'sine.inOut', immediateRender: false }, start + rise);
    }
  });

  return { tl, base };
}

function splitTrailingSpace(text: string) {
  const body = text.trimEnd();
  return [body, text.slice(body.length)] as const;
}

export function SyncedLyrics({ lines, panelRef, onSeek }: {
  lines: LyricLine[];
  panelRef: RefObject<HTMLDivElement | null>;
  onSeek: (time: number) => void;
}) {
  const [active, setActive] = useState(() => activeIndex(lines, getAudio()?.currentTime ?? 0));
  const activeRef = useRef(active);
  const lineRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const wordTimelineRef = useRef<WordTimeline | null>(null);
  const scrollTweenRef = useRef<gsap.core.Tween | null>(null);
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

  /** Jump the scroll position, then let each line catch up with a staggered wave. */
  const follow = (immediate: boolean) => {
    const panel = panelRef.current;
    if (!panel || userScrollingRef.current) return;
    scrollTweenRef.current?.kill();

    const index = activeRef.current;
    const previous = panel.scrollTop;
    panel.scrollTop = targetScrollTop(panel, index);
    const shift = panel.scrollTop - previous;
    if (immediate || Math.abs(shift) < 1 || Math.abs(shift) > panel.clientHeight * 1.5) {
      gsap.set(lineRefs.current.filter(Boolean), { y: 0, overwrite: 'auto' });
      return;
    }

    const anchor = Math.max(0, index);
    lineRefs.current.forEach((el, i) => {
      if (!el) return;
      const offset = i - anchor;
      if (offset < -WAVE_BEFORE - 4 || offset > WAVE_AFTER + 4) {
        gsap.set(el, { y: 0, overwrite: 'auto' });
        return;
      }
      const currentY = Number(gsap.getProperty(el, 'y')) || 0;
      gsap.fromTo(el, { y: currentY + shift }, {
        y: 0,
        duration: 0.9,
        ease: 'power3.out',
        delay: gsap.utils.clamp(0, WAVE_BEFORE + WAVE_AFTER, offset + WAVE_BEFORE) * WAVE_STAGGER,
        overwrite: 'auto',
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
    hasFollowedRef.current = false;
  }, [lines]);

  // Frame-accurate clock: the store only publishes currentTime every 250ms.
  useEffect(() => {
    const audio = getAudio();
    if (!audio) return;
    const tick = () => {
      const time = audio.currentTime;
      const next = activeIndex(lines, time);
      if (next !== activeRef.current) {
        activeRef.current = next;
        setActive(next);
      }
      const words = wordTimelineRef.current;
      if (words) words.tl.time(gsap.utils.clamp(0, words.tl.duration(), time - words.base));
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
      const vars = {
        '--blur': `${reduce ? 0 : Math.min(distance, MAX_BLUR_DISTANCE) * BLUR_PER_LINE}px`,
      };
      const text = el.firstElementChild;
      const scale = i === active || reduce ? 1 : 0.95;
      if (distance > WAVE_AFTER + 4) {
        gsap.set(el, vars);
        if (text) gsap.set(text, { scale });
        return;
      }
      gsap.to(el, { ...vars, duration: 0.6, ease: 'power2.out', overwrite: 'auto' });
      if (text) gsap.to(text, { scale, duration: i === active ? 0.7 : 0.5, ease: i === active ? 'back.out(1.6)' : 'power2.out', overwrite: 'auto' });
    });

    follow(!hasFollowedRef.current || reduce);
    hasFollowedRef.current = true;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, lines]);

  // Word-by-word fill for TTML lines.
  useLayoutEffect(() => {
    const line = lines[active];
    const el = lineRefs.current[active];
    if (!line?.words?.length || !el) return;
    const words = Array.from(el.querySelectorAll<HTMLElement>('.lyrics-word'));
    const built = buildWordTimeline(line, words, prefersReducedMotion());
    built.tl.time(gsap.utils.clamp(0, built.tl.duration(), (getAudio()?.currentTime ?? 0) - built.base));
    wordTimelineRef.current = built;

    return () => {
      built.tl.kill();
      if (wordTimelineRef.current === built) wordTimelineRef.current = null;
      gsap.to(words, { yPercent: 0, scale: 1, '--glow': 0, duration: 0.5, ease: 'power2.out', overwrite: true });
    };
  }, [active, lines]);

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
          className={index === active ? 'is-active' : ''}
          aria-label={line.text || '♪'}
          // Don't take focus on click, so Space keeps toggling playback instead of re-seeking.
          onMouseDown={(event) => event.preventDefault()}
          onClick={() => { endUserScroll(); onSeek(line.time); }}
        >
          <span className={`lyrics-lines__text${line.words?.length ? ' lyrics-lines__text--timed' : ''}`} aria-hidden="true">
            {line.words?.length
              ? line.words.map((word, wordIndex) => {
                  const [body, trailing] = splitTrailingSpace(word.text);
                  return (
                    <Fragment key={`${word.time}-${wordIndex}`}>
                      <span className="lyrics-word">{body}</span>{trailing}
                    </Fragment>
                  );
                })
              : line.text || '♪'}
          </span>
        </button>
      ))}
    </div>
  );
}
