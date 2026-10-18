import { Fragment, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import gsap from 'gsap';
import { formatTime } from '../lib/format';
import { activeIndex, type LyricLine } from '../lib/lrc';
import { getAudio, getPlaybackTime } from '../store/player';
import { IconMic, IconMusic } from './Icons';
import { prepareLine, seededRandom, useTimedStates, type PreparedLine } from './lyricUnits';

// 聊天室: the song as a chat. Each lyric line is a message typed out syllable by syllable; two singers
// take turns in short runs, a typing indicator shows who is about to sing, and each message gets
// its timestamp once fully sent. The history scrolls like the regular lyrics: it follows the newest
// message, pauses while the listener scrolls by hand, and a tap on a message seeks to its line.
// (Re-creates the idea of folia-major's Cappella mode.)

const TYPING_LEAD = 1.1; // seconds before a line starts that its singer shows as typing
const USER_SCROLL_IDLE = 2600; // same pause as the scrolling lyrics before following again
const LIVE_MESSAGES = 2; // only the newest messages can still change, so only they track the clock

/** Two singers alternate in runs of one to three lines — stable for a given song. */
function assignSenders(lines: LyricLine[]) {
  const random = seededRandom(lines.length * 13 + (lines[0]?.time ?? 0));
  let sender = 0;
  let left = 1 + Math.floor(random() * 3);
  return lines.map((line) => {
    if (!line.text.trim()) return sender;
    if (left === 0) {
      sender = 1 - sender;
      left = 1 + Math.floor(random() * 3);
    }
    left -= 1;
    return sender;
  });
}

function Avatar({ sender, hidden }: { sender: number; hidden?: boolean }) {
  return (
    <span className={`cappella-avatar${hidden ? ' cappella-avatar--spacer' : ''}`} aria-hidden="true">
      {sender === 0 ? <IconMic size={17} /> : <IconMusic size={17} />}
    </span>
  );
}

function CappellaMessage({ line, text, sender, showAvatar, current, live, animate, onSeek }: {
  line: PreparedLine;
  text: string;
  sender: number;
  showAvatar: boolean;
  current: boolean;
  live: boolean;
  animate: boolean;
  onSeek: (time: number) => void;
}) {
  const rowRef = useRef<HTMLDivElement | null>(null);
  const bubbleRef = useRef<HTMLButtonElement | null>(null);
  const glyphRefs = useRef<(HTMLSpanElement | null)[]>([]);
  const glyphs = useMemo(() => line.units.flatMap((unit) => unit.glyphs), [line]);
  const whole = useMemo(() => [{ time: line.units[0]?.time ?? line.time, end: line.units.at(-1)?.end ?? line.time }], [line]);

  // Type the message out: a glyph is hidden until its syllable starts. Older messages are fully sent,
  // so they skip the clock entirely and simply show everything.
  useTimedStates(glyphs, live, (i, state, initial) => {
    const el = glyphRefs.current[i];
    if (!el) return;
    const shown = state !== 'waiting';
    if (el.hidden !== shown) return;
    el.hidden = !shown;
    if (shown && !initial) el.classList.add('is-new');
  }, undefined, 'actual');

  useTimedStates(whole, live, (_, state) => {
    rowRef.current?.toggleAttribute('data-done', state === 'passed');
  }, undefined, 'actual');

  useLayoutEffect(() => {
    if (live) return;
    glyphRefs.current.forEach((el) => { if (el) el.hidden = false; });
    rowRef.current?.setAttribute('data-done', '');
  }, [live]);

  useLayoutEffect(() => {
    if (!animate) return;
    const tweens = [
      gsap.from(rowRef.current, { height: 0, opacity: 0, duration: 0.4, ease: 'power3.out', clearProps: 'height,opacity' }),
      gsap.from(bubbleRef.current, { scale: 0.5, duration: 0.5, ease: 'back.out(1.7)', clearProps: 'scale' }),
    ];
    return () => tweens.forEach((tween) => tween.kill());
  // Only a message that has just arrived animates in, once.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  let g = 0;
  return (
    <div ref={rowRef} className={`cappella-row cappella-row--${sender === 0 ? 'left' : 'right'}`} data-current={current || undefined}>
      <Avatar sender={sender} hidden={!showAvatar} />
      <div className="cappella-stack">
        <button
          ref={bubbleRef}
          type="button"
          className="cappella-bubble"
          aria-label={text}
          // Don't take focus on click, so Space keeps toggling playback instead of re-seeking.
          onMouseDown={(event) => event.preventDefault()}
          onClick={() => onSeek(line.time)}
        >
          <span aria-hidden="true">
            {line.units.map((unit, u) => (
              <Fragment key={u}>
                {unit.glyphs.map((glyph) => {
                  const index = g++;
                  return <span key={index} ref={(node) => { glyphRefs.current[index] = node; }} className="cappella-glyph">{glyph.char}</span>;
                })}
                {unit.spaceAfter ? ' ' : null}
              </Fragment>
            ))}
          </span>
        </button>
        <span className="cappella-time">{formatTime(line.time)}</span>
      </div>
    </div>
  );
}

export function CappellaLyrics({ lines, reduce, onSeek }: { lines: LyricLine[]; reduce: boolean; onSeek: (time: number) => void }) {
  const prepared = useMemo(() => lines.map((line, i) => prepareLine(line, lines[i + 1]?.time)), [lines]);
  const senders = useMemo(() => assignSenders(lines), [lines]);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const contentRef = useRef<HTMLDivElement | null>(null);
  const userScrollingRef = useRef(false);
  const userScrollTimerRef = useRef(0);
  const scrollTweenRef = useRef<gsap.core.Tween | null>(null);

  const locate = useCallback((time: number) => {
    const raw = activeIndex(lines, time);
    let next = raw + 1;
    while (next < lines.length && !prepared[next].units.length) next += 1;
    const current = prepared[raw];
    const sent = !current || !current.units.length || time > current.units.at(-1)!.end;
    const typing = next < lines.length && sent && prepared[next].time - time < TYPING_LEAD ? senders[next] : -1;
    return { raw, typing };
  }, [lines, prepared, senders]);

  const [view, setView] = useState(() => locate(getPlaybackTime()));
  const viewRef = useRef(view);
  const seenRef = useRef(new Set<number>());

  useLayoutEffect(() => {
    const next = locate(getPlaybackTime());
    viewRef.current = next;
    setView(next);
    seenRef.current = new Set();
  }, [locate]);

  useEffect(() => {
    const audio = getAudio();
    if (!audio) return;
    const tick = () => {
      const next = locate(getPlaybackTime());
      if (next.raw === viewRef.current.raw && next.typing === viewRef.current.typing) return;
      viewRef.current = next;
      setView(next);
    };
    gsap.ticker.add(tick);
    return () => gsap.ticker.remove(tick);
  }, [locate]);

  // Every message sent so far, oldest first; the listener can scroll back through all of them.
  const visible = useMemo(() => {
    const out: number[] = [];
    for (let i = 0; i <= view.raw; i += 1) if (prepared[i].units.length) out.push(i);
    return out;
  }, [view.raw, prepared]);

  // Remember what has been on screen, so only a newly arriving message animates — not a whole page after a seek.
  const seen = seenRef.current;
  useEffect(() => { visible.forEach((i) => seen.add(i)); }, [visible, seen]);

  const pinToBottom = useCallback((smooth: boolean) => {
    const panel = scrollRef.current;
    if (!panel) return;
    scrollTweenRef.current?.kill();
    const top = panel.scrollHeight - panel.clientHeight;
    if (!smooth) {
      panel.scrollTop = top;
      return;
    }
    const proxy = { top: panel.scrollTop };
    scrollTweenRef.current = gsap.to(proxy, { top, duration: 0.8, ease: 'power3.inOut', onUpdate: () => { panel.scrollTop = proxy.top; } });
  }, []);

  // Follow the conversation: whenever the content grows (new message, typed glyph, typing bubble),
  // stay at the bottom — unless the listener is reading back through the history.
  useLayoutEffect(() => {
    const content = contentRef.current;
    if (!content) return;
    pinToBottom(false);
    const resize = new ResizeObserver(() => { if (!userScrollingRef.current) pinToBottom(false); });
    resize.observe(content);
    return () => resize.disconnect();
  }, [pinToBottom]);

  // Pause following while the listener scrolls by hand; drift back to the newest message after a moment.
  useEffect(() => {
    const panel = scrollRef.current;
    if (!panel) return;
    const audio = getAudio();
    const endUserScroll = () => {
      window.clearTimeout(userScrollTimerRef.current);
      userScrollingRef.current = false;
      panel.removeAttribute('data-user-scrolling');
    };
    const onUserScroll = () => {
      scrollTweenRef.current?.kill();
      userScrollingRef.current = true;
      panel.setAttribute('data-user-scrolling', 'true');
      window.clearTimeout(userScrollTimerRef.current);
      userScrollTimerRef.current = window.setTimeout(() => {
        // While paused, leave the history where the listener put it.
        if (audio?.paused === false) {
          endUserScroll();
          pinToBottom(true);
        }
      }, USER_SCROLL_IDLE);
    };
    // Resuming playback brings the newest message back into view.
    const onPlay = () => {
      endUserScroll();
      pinToBottom(true);
    };
    panel.addEventListener('wheel', onUserScroll, { passive: true });
    panel.addEventListener('touchmove', onUserScroll, { passive: true });
    audio?.addEventListener('play', onPlay);
    return () => {
      panel.removeEventListener('wheel', onUserScroll);
      panel.removeEventListener('touchmove', onUserScroll);
      audio?.removeEventListener('play', onPlay);
      window.clearTimeout(userScrollTimerRef.current);
      scrollTweenRef.current?.kill();
    };
  }, [pinToBottom]);

  const seekTo = useCallback((time: number) => {
    // Seeking is a deliberate jump; let the view follow the conversation again right away.
    window.clearTimeout(userScrollTimerRef.current);
    userScrollingRef.current = false;
    scrollRef.current?.removeAttribute('data-user-scrolling');
    onSeek(time);
  }, [onSeek]);

  const lastSender = visible.length ? senders[visible.at(-1)!] : -1;
  return (
    <div ref={scrollRef} className="cappella" data-lenis-prevent>
      <div ref={contentRef} className="cappella__list">
        {visible.map((index, k) => (
          <CappellaMessage
            key={index}
            line={prepared[index]}
            text={lines[index].text}
            sender={senders[index]}
            showAvatar={k === 0 || senders[visible[k - 1]] !== senders[index]}
            current={index === view.raw}
            live={k >= visible.length - LIVE_MESSAGES}
            animate={!reduce && index === view.raw && !seen.has(index)}
            onSeek={seekTo}
          />
        ))}
        {view.typing >= 0 ? (
          <div className={`cappella-row cappella-row--${view.typing === 0 ? 'left' : 'right'} cappella-row--typing`}>
            <Avatar sender={view.typing} hidden={view.typing === lastSender} />
            <div className="cappella-bubble cappella-typing" aria-label="輸入中"><span /><span /><span /></div>
          </div>
        ) : null}
      </div>
    </div>
  );
}
