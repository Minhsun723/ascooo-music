import { useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { api, artUrl } from '../api/client';
import { DEFAULT_PALETTE, extractPalette, type Palette } from '../lib/color';
import { activeIndex, parseLrc, plainLines } from '../lib/lrc';
import { formatTime, isDolbyAtmos, qualityLabel } from '../lib/format';
import { useCurrentTrack, usePlayer } from '../store/player';
import { Artwork } from './Artwork';
import { DolbyLogo } from './DolbyLogo';
import {
  IconChevronDown,
  IconClose,
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
  IconVolume,
  IconVolumeLow,
  IconWave,
} from './Icons';
import { LikeButton } from './TrackList';

const MARQUEE_GAP = 32;
const MARQUEE_SPEED = 28;

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
        const textWidth = Math.ceil(content.getBoundingClientRect().width);
        const overflowing = textWidth > viewport.clientWidth + 1;
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

function Range({ value, max, onChange, label, className = '' }: { value: number; max: number; onChange: (n: number) => void; label: string; className?: string }) {
  const percentage = max > 0 ? Math.min(100, Math.max(0, value / max * 100)) : 0;
  return (
    <input
      className={`range ${className}`}
      type="range"
      min="0"
      max={max || 1}
      step="0.1"
      value={Math.min(value, max || 1)}
      aria-label={label}
      style={{ '--range-progress': `${percentage}%` } as CSSProperties}
      onChange={(event) => onChange(Number(event.target.value))}
    />
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

  if (!track) return null;
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
          <Range value={currentTime} max={duration} onChange={seek} label="播放進度" />
          <span>{formatTime(duration)}</span>
        </div>
        {error ? <span className="player-error" role="status">{error}</span> : null}
      </div>
      <div className="player-bar__tools">
        {isDolbyAtmos(track) ? <DolbyLogo variant="atmos" className="player-dolby" /> : null}
        {quality ? <span className="quality-badge player-quality">{quality}</span> : null}
        {track.hasLyrics ? <button type="button" className="icon-button" aria-label="顯示歌詞" onClick={() => setNowPlaying(true)}><IconLyrics size={19} /></button> : null}
        <LikeButton track={track} className="player-like" />
        <button type="button" className={`icon-button ${queueOpen ? 'is-active' : ''}`} aria-label="播放佇列" aria-pressed={queueOpen} onClick={() => setQueueOpen(!queueOpen)}><IconQueue size={20} /></button>
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
  if (!open || nowPlayingOpen) return null;

  return (
    <aside className="queue-panel" aria-label="播放佇列">
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

  return (
    <div className={className}>
      {queue.map((track, queueIndex) => (
        <div className={`queue-item ${queueIndex === index ? 'is-current' : ''}`} key={`${track.id}-${queueIndex}`}>
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
  const [lyrics, setLyrics] = useState<{ content: string; synced: boolean } | null>(null);
  const [loading, setLoading] = useState(false);
  const [palette, setPalette] = useState<Palette>(DEFAULT_PALETTE);
  const [shouldRender, setShouldRender] = useState(open);
  const lyricsPanelRef = useRef<HTMLDivElement | null>(null);
  const lineRefs = useRef<(HTMLButtonElement | null)[]>([]);

  useEffect(() => {
    if (open) setShouldRender(true);
  }, [open]);

  useEffect(() => {
    if (!shouldRender || !track) return;
    document.body.classList.add('overlay-open');
    return () => document.body.classList.remove('overlay-open');
  }, [shouldRender, track]);

  useEffect(() => {
    if (!open || !track) return;
    setLoading(true);
    api.lyrics(track.id).then((result) => setLyrics(result.lyrics)).catch(() => setLyrics(null)).finally(() => setLoading(false));
    const art = artUrl(track.artworkId);
    if (art) void extractPalette(art).then(setPalette);
    else setPalette(DEFAULT_PALETTE);
  }, [open, track]);

  const timed = useMemo(() => lyrics?.synced ? parseLrc(lyrics.content) : [], [lyrics]);
  const plain = useMemo(() => lyrics && !lyrics.synced ? plainLines(lyrics.content) : [], [lyrics]);
  const active = timed.length ? activeIndex(timed, currentTime) : -1;

  useEffect(() => {
    if (!open || queueOpen) return;
    const panel = lyricsPanelRef.current;
    const line = active >= 0 ? lineRefs.current[active] : null;
    if (!panel || !line) return;

    const panelRect = panel.getBoundingClientRect();
    const lineRect = line.getBoundingClientRect();
    const top = panel.scrollTop + lineRect.top - panelRect.top - (panel.clientHeight - lineRect.height) / 2;
    panel.scrollTo({ top: Math.max(0, top) });
  }, [active, open, queueOpen, timed]);

  useEffect(() => {
    if (!open) return;
    const close = (event: KeyboardEvent) => { if (event.key === 'Escape') setOpen(false); };
    window.addEventListener('keydown', close);
    return () => window.removeEventListener('keydown', close);
  }, [open, setOpen]);

  if (!shouldRender || !track) return null;
  const style = { '--now-accent': palette.accent, '--now-deep': palette.deep, '--now-glow': palette.glow } as CSSProperties;
  const quality = qualityLabel(track);

  return (
    <section
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
      <header className="now-playing__header">
        <button type="button" className="round-button" aria-label="關閉正在播放" onClick={() => setOpen(false)}><IconChevronDown /></button>
        <span className="now-playing__label">
          <span>NOW PLAYING</span>
          {isDolbyAtmos(track) ? <DolbyLogo variant="atmos" className="now-playing__dolby" /> : quality ? <span className="quality-badge">{quality}</span> : null}
        </span>
      </header>
      <div className="now-playing__layout">
        <div className="now-playing__visual">
          <Artwork artworkId={track.artworkId} title={track.title} artist={track.artist} className="now-playing__art" loading="eager" />
          <div className="now-playing__meta">
            <h1><OverflowMarquee key={track.id} text={track.title} /></h1>
            <div className="now-playing__artist-row">
              <p><OverflowMarquee key={`${track.id}-album`} text={`${track.artist} · ${track.album}`} /></p>
              <div className="now-playing__meta-actions">
                <button type="button" className={`icon-button ${!queueOpen ? 'is-active' : ''}`} aria-label="顯示歌詞" aria-pressed={!queueOpen} onClick={() => setQueueOpen(false)}><IconLyrics size={19} /></button>
                <LikeButton track={track} className="now-playing__like" />
              </div>
            </div>
          </div>
          <Range value={currentTime} max={duration} onChange={seek} label="播放進度" />
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
          <div ref={lyricsPanelRef} className="lyrics-panel" data-lenis-prevent>
            <div className="lyrics-panel__heading"><h2>歌詞</h2></div>
            {loading ? <div className="lyrics-skeleton"><span /><span /><span /><span /></div> : null}
            {!loading && !lyrics ? <div className="lyrics-empty"><IconLyrics size={28} /><p>這首歌還沒有歌詞</p></div> : null}
            {timed.length ? <div className="lyrics-lines">{timed.map((line, index) => (
              <button type="button" key={`${line.time}-${index}`} ref={(node) => { lineRefs.current[index] = node; }} className={index === active ? 'is-active' : ''} onClick={() => seek(line.time)}>
                <span className="lyrics-lines__text">{line.text || '♪'}</span>
              </button>
            ))}</div> : null}
            {plain.length ? <div className="lyrics-lines lyrics-lines--plain">{plain.map((line, index) => <p key={`${line}-${index}`}>{line || <br />}</p>)}</div> : null}
          </div>
        )}
      </div>
    </section>
  );
}
