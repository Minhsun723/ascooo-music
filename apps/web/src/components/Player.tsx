import { useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type PointerEvent as ReactPointerEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { api, artUrl } from '../api/client';
import type { Lyrics, Track } from '../api/types';
import { DEFAULT_PALETTE, extractPalette, type Palette } from '../lib/color';
import { parseLrc, parseTtml, plainLines } from '../lib/lrc';
import { formatTime, isDolbyAtmos, qualityLabel, trackArtists } from '../lib/format';
import { useCurrentTrack, usePlayer } from '../store/player';
import { usePreferences } from '../store/preferences';
import { Artwork } from './Artwork';
import { DolbyLogo, SurroundLogo } from './DolbyLogo';
import {
  IconChevronDown,
  IconClose,
  IconDisc,
  IconLyrics,
  IconMute,
  IconNext,
  IconPause,
  IconPlay,
  IconPrev,
  IconQueue,
  IconRepeat,
  IconRepeatOne,
  IconShuffle,
  IconTrash,
  IconUser,
  IconVolume,
  IconVolumeLow,
  IconWave,
} from './Icons';
import { ImmersiveLyrics } from './ImmersiveLyrics';
import { SyncedLyrics } from './SyncedLyrics';
import { LikeButton } from './TrackList';

const MARQUEE_GAP = 32;
const MARQUEE_SPEED = 28;
const PLAYER_DRAG_DISMISS_MAX = 96;
const PLAYER_DRAG_DISMISS_RATIO = 0.12;
const PLAYER_FLICK_VELOCITY = 0.2;
const PLAYER_FLICK_MIN_DISTANCE = 24;

function transformTranslateY(transform: string) {
  if (!transform || transform === 'none') return 0;
  const values = transform.slice(transform.indexOf('(') + 1, -1).split(',').map(Number);
  const y = transform.startsWith('matrix3d') ? values[13] : values[5];
  return Number.isFinite(y) ? y : 0;
}

function OverflowMarquee({ text, play = true }: { text: string; play?: boolean }) {
  const viewportRef = useRef<HTMLSpanElement | null>(null);
  const textRef = useRef<HTMLSpanElement | null>(null);
  const [metrics, setMetrics] = useState({ overflowing: false, distance: 0, duration: 0 });

  useLayoutEffect(() => {
    const viewport = viewportRef.current;
    const content = textRef.current;
    if (!viewport || !content) return;

    let animationFrame = 0;
    const measure = () => {
      cancelAnimationFrame(animationFrame);
      animationFrame = requestAnimationFrame(() => {
        const textWidth = content.getBoundingClientRect().width;
        const overflowing = Math.ceil(textWidth) > viewport.clientWidth + 1;
        // Keep the fraction: each loop must travel exactly one text + gap, or the jump back to
        // the start lands a sub-pixel off and the text visibly blinks at the seam.
        const distance = textWidth + MARQUEE_GAP;
        const duration = distance / MARQUEE_SPEED;

        setMetrics((current) => (
          current.overflowing === overflowing
          && current.distance === distance
          && current.duration === duration
            ? current
            : { overflowing, distance, duration }
        ));
      });
    };

    measure();
    const resizeObserver = new ResizeObserver(measure);
    resizeObserver.observe(viewport);
    resizeObserver.observe(content);

    return () => {
      cancelAnimationFrame(animationFrame);
      resizeObserver.disconnect();
    };
  }, [text]);

  const style = {
    '--marquee-offset': `-${metrics.distance}px`,
    '--marquee-duration': `${metrics.duration}s`,
  } as CSSProperties;

  return (
    <span
      ref={viewportRef}
      className="marquee"
      data-overflow={metrics.overflowing || undefined}
      data-play={metrics.overflowing && play ? true : undefined}
      title={metrics.overflowing ? text : undefined}
    >
      <span className="marquee__track" style={style}>
        <span ref={textRef} className="marquee__text">{text}</span>
        {metrics.overflowing && play ? <span className="marquee__text marquee__text--clone" aria-hidden="true">{text}</span> : null}
      </span>
    </span>
  );
}

/** Artist · album line; tapping it offers to jump to either page. */
function BylineMenu({ track }: { track: Track }) {
  const detailsRef = useRef<HTMLDetailsElement>(null);
  const [open, setOpen] = useState(false);
  const navigate = useNavigate();
  const setNowPlaying = usePlayer((s) => s.setNowPlaying);
  const text = [track.artist, track.album].filter(Boolean).join(' · ');
  const byline = <OverflowMarquee text={text} />;

  useEffect(() => {
    if (!open) return;
    const details = detailsRef.current;
    const onPointerDown = (event: PointerEvent) => {
      if (details && !details.contains(event.target as Node)) details.removeAttribute('open');
    };
    // Capture phase, so Escape closes just the menu instead of the whole player.
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.stopPropagation();
      details?.removeAttribute('open');
    };
    document.addEventListener('pointerdown', onPointerDown);
    window.addEventListener('keydown', onKeyDown, true);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown);
      window.removeEventListener('keydown', onKeyDown, true);
    };
  }, [open]);

  const artists = trackArtists(track);
  if (!artists.length && track.albumId === null) return <p className="now-playing__byline">{byline}</p>;

  const go = (path: string, pageTitle: string) => {
    detailsRef.current?.removeAttribute('open');
    setNowPlaying(false);
    navigate(path, { state: { pageTitle } });
  };

  return (
    <details ref={detailsRef} className="now-playing__byline-menu" onToggle={(event) => setOpen(event.currentTarget.open)}>
      <summary className="now-playing__byline" aria-label={`${text}，更多選項`}>{byline}</summary>
      <div className="menu-popover">
        {artists.map((artist) => (
          <button key={artist.id} type="button" onClick={() => go(`/artist/${artist.id}`, artist.name)}>
            <IconUser size={18} />{artists.length > 1 ? `前往 ${artist.name}` : '前往歌手'}
          </button>
        ))}
        {track.albumId !== null ? (
          <button type="button" onClick={() => go(`/album/${track.albumId}`, track.album)}>
            <IconDisc size={18} />前往專輯
          </button>
        ) : null}
      </div>
    </details>
  );
}

const RANGE_THUMB = 12;

function Range({ value, max, onChange, label, className = '', commitOnRelease = false }: {
  value: number;
  max: number;
  onChange: (n: number) => void;
  label: string;
  className?: string;
  /** Touch scrubs only preview until the finger lifts. Phones grant media playback to the lift,
   *  not the press, so a seek that has to load an idle track must happen then. */
  commitOnRelease?: boolean;
}) {
  const [preview, setPreview] = useState<number | null>(null);
  const shown = preview ?? value;
  const percentage = max > 0 ? Math.min(100, Math.max(0, shown / max * 100)) : 0;
  const scrubRef = useRef<number | null>(null);
  const previewRef = useRef<number | null>(null);

  // Touch screens make the input itself inert (see .range-field in styles.css): iOS only drags a
  // native range by its thumb and lets vertical wobble scroll the sheet, so the wrapper scrubs
  // from wherever the finger lands. With a mouse the input receives the press and works natively.
  const scrubTo = (field: HTMLElement, clientX: number) => {
    if (max <= 0) return;
    const rect = field.getBoundingClientRect();
    const ratio = (clientX - rect.left - RANGE_THUMB / 2) / Math.max(1, rect.width - RANGE_THUMB);
    const next = Math.min(1, Math.max(0, ratio)) * max;
    if (!commitOnRelease) return onChange(next);
    previewRef.current = next;
    setPreview(next);
  };

  const endScrub = (event: ReactPointerEvent<HTMLDivElement>, commit: boolean) => {
    if (scrubRef.current !== event.pointerId) return;
    scrubRef.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
    event.currentTarget.removeAttribute('data-scrubbing');
    const committed = previewRef.current;
    previewRef.current = null;
    setPreview(null);
    if (commit && committed !== null) onChange(committed);
  };

  return (
    <div
      className={`range-field ${className}`}
      onPointerDown={(event) => {
        if (event.target !== event.currentTarget || !event.isPrimary || event.button !== 0) return;
        scrubRef.current = event.pointerId;
        event.currentTarget.dataset.scrubbing = 'true';
        try { event.currentTarget.setPointerCapture(event.pointerId); } catch { /* still scrubs while over the bar */ }
        scrubTo(event.currentTarget, event.clientX);
      }}
      onPointerMove={(event) => {
        if (scrubRef.current === event.pointerId) scrubTo(event.currentTarget, event.clientX);
      }}
      onPointerUp={(event) => endScrub(event, true)}
      onPointerCancel={(event) => endScrub(event, false)}
      onLostPointerCapture={(event) => endScrub(event, false)}
    >
      <input
        className="range"
        type="range"
        min="0"
        max={max || 1}
        step="0.1"
        value={Math.min(shown, max || 1)}
        aria-label={label}
        style={{ '--range-progress': `${percentage}%` } as CSSProperties}
        onChange={(event) => onChange(Number(event.target.value))}
      />
    </div>
  );
}

function CoreControls({ large = false }: { large?: boolean }) {
  const isPlaying = usePlayer((s) => s.isPlaying);
  const isBuffering = usePlayer((s) => s.isBuffering);
  const shuffle = usePlayer((s) => s.shuffle);
  const repeat = usePlayer((s) => s.repeat);
  const toggle = usePlayer((s) => s.toggle);
  const prev = usePlayer((s) => s.prev);
  const next = usePlayer((s) => s.next);
  const toggleShuffle = usePlayer((s) => s.toggleShuffle);
  const cycleRepeat = usePlayer((s) => s.cycleRepeat);

  return (
    <div className={`core-controls ${large ? 'core-controls--large' : ''}`}>
      <button type="button" className={`icon-button ${shuffle ? 'is-active' : ''}`} aria-label="隨機播放" aria-pressed={shuffle} onClick={toggleShuffle}><IconShuffle size={18} /></button>
      <button type="button" className="icon-button" aria-label="上一首" onClick={prev}><IconPrev size={large ? 24 : 20} /></button>
      <button type="button" className={`play-button ${isBuffering ? 'is-loading' : ''}`} aria-label={isPlaying ? '暫停' : '播放'} onClick={toggle}>
        {isPlaying ? <IconPause size={large ? 25 : 20} /> : <IconPlay size={large ? 25 : 20} />}
      </button>
      <button type="button" className="icon-button" aria-label="下一首" onClick={next}><IconNext size={large ? 24 : 20} /></button>
      <button type="button" className={`icon-button ${repeat !== 'off' ? 'is-active' : ''}`} aria-label={`循環模式：${repeat === 'one' ? '單曲循環' : repeat === 'all' ? '全部循環' : '關閉'}`} onClick={cycleRepeat}>
        {repeat === 'one' ? <IconRepeatOne size={18} /> : <IconRepeat size={18} />}
      </button>
    </div>
  );
}

export function PlayerBar() {
  const track = useCurrentTrack();
  const currentTime = usePlayer((s) => s.currentTime);
  const duration = usePlayer((s) => s.duration);
  const volume = usePlayer((s) => s.volume);
  const muted = usePlayer((s) => s.muted);
  const error = usePlayer((s) => s.error);
  const seek = usePlayer((s) => s.seek);
  const setVolume = usePlayer((s) => s.setVolume);
  const toggleMute = usePlayer((s) => s.toggleMute);
  const setNowPlaying = usePlayer((s) => s.setNowPlaying);
  const setQueueOpen = usePlayer((s) => s.setQueueOpen);
  const queueOpen = usePlayer((s) => s.queueOpen);
  const source = usePlayer((s) => s.source);

  if (!track) return null;
  const playingAtmos = isDolbyAtmos(track) && source === 'original';
  const quality = qualityLabel(track);

  return (
    <footer className="player-bar" aria-label="音樂播放器">
      <div className="player-bar__signal" style={{ '--play-progress': `${duration ? currentTime / duration * 100 : 0}%` } as CSSProperties} aria-hidden="true" />
      <div className="player-bar__track-group">
        <button type="button" className="player-track" onClick={() => setNowPlaying(true)} aria-label={`開啟正在播放：${track.title}`}>
          <Artwork artworkId={track.artworkId} title={track.title} artist={track.artist} className="player-track__art" />
          <span className="player-track__copy"><strong><OverflowMarquee key={track.id} text={track.title} /></strong><small>{track.artist}</small></span>
        </button>
      </div>
      <div className="player-bar__center">
        <CoreControls />
        <div className="player-progress">
          <span>{formatTime(currentTime)}</span>
          <Range value={currentTime} max={duration} onChange={seek} label="播放進度" commitOnRelease />
          <span>{formatTime(duration)}</span>
        </div>
        {error ? <span className="player-error" role="status">{error}</span> : null}
      </div>
      <div className="player-bar__tools">
        {playingAtmos ? <DolbyLogo variant="atmos" className="player-dolby" /> : source === 'aac51' ? <SurroundLogo variant="atmos" className="player-dolby" /> : null}
        {quality ? <span className="quality-badge player-quality">{quality}</span> : null}
        {track.hasLyrics ? <button type="button" className="icon-button" aria-label="顯示歌詞" onClick={() => setNowPlaying(true)}><IconLyrics size={19} /></button> : null}
        <LikeButton track={track} className="player-like" />
        <button type="button" className={`icon-button ${queueOpen ? 'is-active' : ''}`} aria-label="播放佇列" aria-pressed={queueOpen} data-queue-toggle onClick={() => setQueueOpen(!queueOpen)}><IconQueue size={20} /></button>
        <button type="button" className="icon-button" aria-label={muted ? '取消靜音' : '靜音'} onClick={toggleMute}>
          {muted || volume === 0 ? <IconMute size={19} /> : volume < 0.5 ? <IconVolumeLow size={19} /> : <IconVolume size={19} />}
        </button>
        <Range className="volume-range" value={muted ? 0 : volume} max={1} onChange={setVolume} label="音量" />
      </div>
    </footer>
  );
}

export function QueuePanel() {
  const open = usePlayer((s) => s.queueOpen);
  const nowPlayingOpen = usePlayer((s) => s.nowPlayingOpen);
  const setOpen = usePlayer((s) => s.setQueueOpen);
  const panelRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (!open || nowPlayingOpen) return;

    // The toggle button handles its own click; dismissing here first would make that click reopen the panel.
    const dismissOnOutsidePress = (event: PointerEvent) => {
      const panel = panelRef.current;
      if (event.target instanceof Element && event.target.closest('[data-queue-toggle]')) return;
      if (panel && event.target instanceof Node && !panel.contains(event.target)) setOpen(false);
    };
    const dismissOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };

    document.addEventListener('pointerdown', dismissOnOutsidePress);
    window.addEventListener('keydown', dismissOnEscape);
    return () => {
      document.removeEventListener('pointerdown', dismissOnOutsidePress);
      window.removeEventListener('keydown', dismissOnEscape);
    };
  }, [nowPlayingOpen, open, setOpen]);

  if (!open || nowPlayingOpen) return null;

  return (
    <aside ref={panelRef} className="queue-panel" aria-label="播放佇列">
      <div className="panel-heading"><h2>播放佇列</h2><button type="button" className="icon-button" aria-label="關閉播放佇列" onClick={() => setOpen(false)}><IconClose /></button></div>
      <QueueList className="queue-panel__list" />
    </aside>
  );
}

function QueueList({ className }: { className: string }) {
  const queue = usePlayer((s) => s.queue);
  const index = usePlayer((s) => s.index);
  const jumpTo = usePlayer((s) => s.jumpTo);
  const removeFromQueue = usePlayer((s) => s.removeFromQueue);
  const listRef = useRef<HTMLDivElement | null>(null);
  const currentItemRef = useRef<HTMLDivElement | null>(null);
  const currentTrack = queue[index];

  useLayoutEffect(() => {
    const container = listRef.current;
    const item = currentItemRef.current;
    if (!container || !item) return;

    const containerRect = container.getBoundingClientRect();
    const itemRect = item.getBoundingClientRect();
    const top = container.scrollTop + itemRect.top - containerRect.top - (container.clientHeight - itemRect.height) / 2;
    container.scrollTo({ top: Math.max(0, top), behavior: 'instant' });
  }, [currentTrack?.id, index]);

  return (
    <div ref={listRef} className={className}>
      {queue.map((track, queueIndex) => (
        <div ref={queueIndex === index ? currentItemRef : undefined} className={`queue-item ${queueIndex === index ? 'is-current' : ''}`} key={`${track.id}-${queueIndex}`}>
          <button type="button" className="queue-item__main" onClick={() => jumpTo(queueIndex)}>
            <Artwork artworkId={track.artworkId} title={track.title} className="queue-item__art" />
            <span><strong>{track.title}</strong><small>{track.artist}</small></span>
          </button>
          {queueIndex !== index ? <button type="button" className="icon-button" aria-label={`從佇列移除 ${track.title}`} onClick={() => removeFromQueue(queueIndex)}><IconTrash size={17} /></button> : <span className="queue-item__playing"><IconWave size={19} aria-hidden="true" /><span className="sr-only">播放中</span></span>}
        </div>
      ))}
    </div>
  );
}

function NowPlayingQueue() {
  return (
    <section className="now-playing-queue" aria-label="播放佇列" data-lenis-prevent>
      <header className="now-playing-queue__heading">
        <h2>播放佇列</h2>
      </header>
      <QueueList className="now-playing-queue__list" />
    </section>
  );
}

export function NowPlaying() {
  const open = usePlayer((s) => s.nowPlayingOpen);
  const track = useCurrentTrack();
  const currentTime = usePlayer((s) => s.currentTime);
  const duration = usePlayer((s) => s.duration);
  const volume = usePlayer((s) => s.volume);
  const muted = usePlayer((s) => s.muted);
  const queueOpen = usePlayer((s) => s.queueOpen);
  const seek = usePlayer((s) => s.seek);
  const setVolume = usePlayer((s) => s.setVolume);
  const toggleMute = usePlayer((s) => s.toggleMute);
  const setQueueOpen = usePlayer((s) => s.setQueueOpen);
  const setOpen = usePlayer((s) => s.setNowPlaying);
  const source = usePlayer((s) => s.source);
  const lyricsMode = usePreferences((s) => s.lyricsMode);
  const immersiveStyle = usePreferences((s) => s.immersiveStyle);
  const [lyrics, setLyrics] = useState<Lyrics | null>(null);
  const [loading, setLoading] = useState(false);
  const [palette, setPalette] = useState<Palette>(DEFAULT_PALETTE);
  const [shouldRender, setShouldRender] = useState(open);
  const nowPlayingRef = useRef<HTMLElement | null>(null);
  const lyricsPanelRef = useRef<HTMLDivElement | null>(null);
  const settleAnimationRef = useRef<Animation | null>(null);
  const dragRef = useRef<{
    pointerId: number;
    startY: number;
    baseY: number;
    currentY: number;
    startTime: number;
  } | null>(null);

  useEffect(() => {
    if (open) setShouldRender(true);
  }, [open]);

  useLayoutEffect(() => {
    if (!shouldRender || !track) return;
    const body = document.body;
    const scrollbarWidth = Math.max(0, window.innerWidth - document.documentElement.clientWidth);
    body.style.setProperty('--scrollbar-compensation', `${scrollbarWidth}px`);
    body.classList.add('overlay-open');
    return () => {
      body.classList.remove('overlay-open');
      body.style.removeProperty('--scrollbar-compensation');
    };
  }, [shouldRender, track]);

  useLayoutEffect(() => {
    lyricsPanelRef.current?.scrollTo({ top: 0, behavior: 'instant' });
  }, [track?.id]);

  useEffect(() => {
    if (!open || !track) return;
    let cancelled = false;
    setLyrics(null);
    setLoading(true);
    api.lyrics(track.id)
      .then((result) => { if (!cancelled) setLyrics(result.lyrics); })
      .catch(() => { if (!cancelled) setLyrics(null); })
      .finally(() => { if (!cancelled) setLoading(false); });
    const art = artUrl(track.artworkId);
    if (art) void extractPalette(art).then((nextPalette) => { if (!cancelled) setPalette(nextPalette); });
    else setPalette(DEFAULT_PALETTE);
    return () => { cancelled = true; };
  }, [open, track]);

  // The AAC 5.1 copy is made from the Atmos file, so it shares the spatial timeline too.
  const spatial = !!track && isDolbyAtmos(track);
  const timed = useMemo(() => {
    if (!lyrics?.synced) return [];
    return lyrics.format === 'ttml' ? parseTtml(lyrics.content, { spatial }) : parseLrc(lyrics.content);
  }, [lyrics, spatial]);
  const plain = useMemo(() => lyrics && !lyrics.synced ? plainLines(lyrics.content) : [], [lyrics]);

  useEffect(() => {
    if (!open) return;
    const close = (event: KeyboardEvent) => { if (event.key === 'Escape') setOpen(false); };
    window.addEventListener('keydown', close);
    return () => window.removeEventListener('keydown', close);
  }, [open, setOpen]);

  // Stacked (phone / portrait tablet) layouts scroll the whole sheet; the side-by-side
  // layout clips it, so a scroll offset left over from rotating would strand the content.
  useEffect(() => {
    if (!shouldRender) return;
    const resetClippedScroll = () => {
      const player = nowPlayingRef.current;
      if (player && player.scrollTop !== 0 && getComputedStyle(player).overflowY === 'hidden') player.scrollTop = 0;
    };
    window.addEventListener('resize', resetClippedScroll);
    return () => window.removeEventListener('resize', resetClippedScroll);
  }, [shouldRender]);

  useEffect(() => () => settleAnimationRef.current?.cancel(), []);

  const startPlayerDrag = (event: ReactPointerEvent<HTMLElement>) => {
    if (!event.isPrimary || event.button !== 0 || dragRef.current) return;
    if ((event.target as HTMLElement).closest('button, a, input, summary')) return;
    const player = nowPlayingRef.current;
    if (!player) return;

    const currentY = transformTranslateY(getComputedStyle(player).transform);
    settleAnimationRef.current?.cancel();
    settleAnimationRef.current = null;
    for (const animation of player.getAnimations({ subtree: false })) {
      if (animation.playState === 'running') animation.finish();
    }

    dragRef.current = {
      pointerId: event.pointerId,
      startY: event.clientY,
      baseY: currentY,
      currentY,
      startTime: event.timeStamp,
    };
    player.dataset.dragging = 'true';
    player.style.transform = `translate3d(0, ${currentY}px, 0)`;
    event.currentTarget.setPointerCapture(event.pointerId);
  };

  const movePlayerDrag = (event: ReactPointerEvent<HTMLElement>) => {
    const drag = dragRef.current;
    const player = nowPlayingRef.current;
    if (!drag || !player || drag.pointerId !== event.pointerId) return;

    const rawDistance = drag.baseY + event.clientY - drag.startY;
    const distance = rawDistance >= 0 ? rawDistance : rawDistance * 0.18;
    drag.currentY = distance;
    player.style.transform = `translate3d(0, ${distance}px, 0)`;
  };

  const finishPlayerDrag = (event: ReactPointerEvent<HTMLElement>, cancelled = false) => {
    const drag = dragRef.current;
    const player = nowPlayingRef.current;
    if (!drag || !player || drag.pointerId !== event.pointerId) return;
    dragRef.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);

    const rawDistance = drag.baseY + event.clientY - drag.startY;
    drag.currentY = rawDistance >= 0 ? rawDistance : rawDistance * 0.18;
    player.style.transform = `translate3d(0, ${drag.currentY}px, 0)`;
    const gestureDistance = Math.max(0, event.clientY - drag.startY);
    const gestureDuration = Math.max(1, event.timeStamp - drag.startTime);
    const gestureVelocity = gestureDistance / gestureDuration;
    const dismissDistance = Math.min(window.innerHeight * PLAYER_DRAG_DISMISS_RATIO, PLAYER_DRAG_DISMISS_MAX);
    const shouldDismiss = !cancelled && drag.currentY > 0 && (
      drag.currentY >= dismissDistance
      || (gestureVelocity >= PLAYER_FLICK_VELOCITY && gestureDistance >= PLAYER_FLICK_MIN_DISTANCE)
    );

    if (shouldDismiss) {
      player.style.setProperty('--now-exit-y', `${drag.currentY}px`);
      player.style.setProperty('--now-exit-duration', '400ms');
      player.removeAttribute('data-dragging');
      setOpen(false);
      return;
    }

    const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const easing = getComputedStyle(document.documentElement).getPropertyValue('--ease-drawer').trim();
    const animation = player.animate(
      [
        { transform: `translate3d(0, ${drag.currentY}px, 0)` },
        { transform: 'translate3d(0, 0, 0)' },
      ],
      { duration: reduceMotion ? 160 : 300, easing: reduceMotion ? 'ease' : easing, fill: 'forwards' },
    );
    settleAnimationRef.current = animation;
    animation.onfinish = () => {
      if (settleAnimationRef.current !== animation) return;
      player.style.transform = '';
      player.removeAttribute('data-dragging');
      animation.cancel();
      settleAnimationRef.current = null;
    };
  };

  if (!shouldRender || !track) return null;
  const style = { '--now-accent': palette.accent, '--now-deep': palette.deep, '--now-glow': palette.glow } as CSSProperties;
  const playingAtmos = isDolbyAtmos(track) && source === 'original';
  const quality = qualityLabel(track);
  const immersive = lyricsMode === 'immersive' && timed.length > 0;

  return (
    <section
      ref={nowPlayingRef}
      className="now-playing"
      data-state={open ? 'open' : 'closed'}
      style={style}
      aria-label="正在播放"
      aria-hidden={!open}
      onAnimationEnd={(event) => {
        if (!open && event.target === event.currentTarget) setShouldRender(false);
      }}
    >
      <div className="now-playing__ambient" aria-hidden="true" />
      <header
        className="now-playing__header"
        onPointerDown={startPlayerDrag}
        onPointerMove={movePlayerDrag}
        onPointerUp={finishPlayerDrag}
        onPointerCancel={(event) => finishPlayerDrag(event, true)}
        onLostPointerCapture={(event) => finishPlayerDrag(event, true)}
      >
        <button type="button" className="icon-button now-playing__close" aria-label="關閉正在播放" onClick={() => setOpen(false)}><IconChevronDown /></button>
        <span className="now-playing__label">
          <span>NOW PLAYING</span>
          {playingAtmos ? <DolbyLogo variant="atmos" className="now-playing__dolby" /> : source === 'aac51' ? <SurroundLogo variant="atmos" className="now-playing__dolby" /> : quality ? <span className="quality-badge">{quality}</span> : null}
        </span>
      </header>
      <div className="now-playing__layout">
        <div className="now-playing__visual">
          <Artwork artworkId={track.artworkId} title={track.title} artist={track.artist} className="now-playing__art" loading="eager" size={2000} />
          <div className="now-playing__meta">
            <h1><OverflowMarquee key={track.id} text={track.title} /></h1>
            <div className="now-playing__artist-row">
              <BylineMenu key={track.id} track={track} />
              <div className="now-playing__meta-actions">
                <button type="button" className={`icon-button ${!queueOpen ? 'is-active' : ''}`} aria-label="顯示歌詞" aria-pressed={!queueOpen} onClick={() => setQueueOpen(false)}><IconLyrics size={19} /></button>
                <LikeButton track={track} className="now-playing__like" />
              </div>
            </div>
          </div>
          <Range value={currentTime} max={duration} onChange={seek} label="播放進度" commitOnRelease />
          <div className="now-playing__time"><span>{formatTime(currentTime)}</span><span>-{formatTime(Math.max(0, duration - currentTime))}</span></div>
          <div className="now-playing__controls">
            <div className="now-playing__volume">
              <button type="button" className="icon-button" aria-label={muted ? '取消靜音' : '靜音'} onClick={toggleMute}>
                {muted || volume === 0 ? <IconMute size={20} /> : volume < 0.5 ? <IconVolumeLow size={20} /> : <IconVolume size={20} />}
              </button>
              <Range className="now-playing__volume-range" value={muted ? 0 : volume} max={1} onChange={setVolume} label="音量" />
            </div>
            <CoreControls large />
            <button type="button" className={`icon-button now-playing__queue-button ${queueOpen ? 'is-active' : ''}`} aria-label={queueOpen ? '關閉播放佇列' : '顯示播放佇列'} aria-pressed={queueOpen} onClick={() => setQueueOpen(!queueOpen)}><IconQueue size={21} /></button>
          </div>
        </div>
        {queueOpen ? <NowPlayingQueue /> : (
          <div ref={lyricsPanelRef} className={`lyrics-panel${immersive ? ' lyrics-panel--immersive' : ''}`} data-lenis-prevent>
            {immersive ? null : <div className="lyrics-panel__heading"><h2>歌詞</h2></div>}
            {loading ? <div className="lyrics-skeleton"><span /><span /><span /><span /></div> : null}
            {!loading && !lyrics ? <div className="lyrics-empty"><IconLyrics size={28} /><p>這首歌還沒有歌詞</p></div> : null}
            {immersive ? <ImmersiveLyrics key={immersiveStyle} lines={timed} styleName={immersiveStyle} onSeek={seek} /> : timed.length ? <SyncedLyrics lines={timed} panelRef={lyricsPanelRef} onSeek={seek} /> : null}
            {plain.length ? <div className="lyrics-lines lyrics-lines--plain">{plain.map((line, index) => <p key={`${line}-${index}`}>{line || <br />}</p>)}</div> : null}
          </div>
        )}
      </div>
    </section>
  );
}
