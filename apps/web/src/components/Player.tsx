import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { api, artUrl } from '../api/client';
import { DEFAULT_PALETTE, extractPalette, type Palette } from '../lib/color';
import { activeIndex, parseLrc, plainLines } from '../lib/lrc';
import { formatTime, isDolbyAtmos, qualityParts } from '../lib/format';
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
} from './Icons';
import { LikeButton } from './TrackList';

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
  const quality = qualityParts(track).join(' · ');

  return (
    <footer className="player-bar" aria-label="音樂播放器">
      <div className="player-bar__signal" style={{ '--play-progress': `${duration ? currentTime / duration * 100 : 0}%` } as CSSProperties} aria-hidden="true" />
      <div className="player-bar__track-group">
        <button type="button" className="player-track" onClick={() => setNowPlaying(true)} aria-label={`開啟正在播放：${track.title}`}>
          <Artwork artworkId={track.artworkId} title={track.title} artist={track.artist} className="player-track__art" />
          <span className="player-track__copy"><strong>{track.title}</strong><small>{track.artist}</small></span>
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
        {quality ? <span className="player-quality">{quality}</span> : null}
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
  const queue = usePlayer((s) => s.queue);
  const index = usePlayer((s) => s.index);
  const jumpTo = usePlayer((s) => s.jumpTo);
  const removeFromQueue = usePlayer((s) => s.removeFromQueue);
  const setOpen = usePlayer((s) => s.setQueueOpen);
  if (!open) return null;

  return (
    <aside className="queue-panel" aria-label="播放佇列">
      <div className="panel-heading"><div><span className="eyebrow">UP NEXT</span><h2>播放佇列</h2></div><button type="button" className="icon-button" aria-label="關閉播放佇列" onClick={() => setOpen(false)}><IconClose /></button></div>
      <div className="queue-panel__list">
        {queue.map((track, queueIndex) => (
          <div className={`queue-item ${queueIndex === index ? 'is-current' : ''}`} key={`${track.id}-${queueIndex}`}>
            <button type="button" className="queue-item__main" onClick={() => jumpTo(queueIndex)}>
              <Artwork artworkId={track.artworkId} title={track.title} className="queue-item__art" />
              <span><strong>{track.title}</strong><small>{track.artist}</small></span>
            </button>
            {queueIndex !== index ? <button type="button" className="icon-button" aria-label={`從佇列移除 ${track.title}`} onClick={() => removeFromQueue(queueIndex)}><IconTrash size={17} /></button> : <span className="queue-item__playing">播放中</span>}
          </div>
        ))}
      </div>
    </aside>
  );
}

export function NowPlaying() {
  const open = usePlayer((s) => s.nowPlayingOpen);
  const track = useCurrentTrack();
  const currentTime = usePlayer((s) => s.currentTime);
  const duration = usePlayer((s) => s.duration);
  const seek = usePlayer((s) => s.seek);
  const setOpen = usePlayer((s) => s.setNowPlaying);
  const [lyrics, setLyrics] = useState<{ content: string; synced: boolean } | null>(null);
  const [loading, setLoading] = useState(false);
  const [palette, setPalette] = useState<Palette>(DEFAULT_PALETTE);
  const lineRefs = useRef<(HTMLButtonElement | null)[]>([]);

  useEffect(() => {
    if (!open || !track) return;
    document.body.classList.add('overlay-open');
    setLoading(true);
    api.lyrics(track.id).then((result) => setLyrics(result.lyrics)).catch(() => setLyrics(null)).finally(() => setLoading(false));
    const art = artUrl(track.artworkId);
    if (art) void extractPalette(art).then(setPalette);
    else setPalette(DEFAULT_PALETTE);
    return () => document.body.classList.remove('overlay-open');
  }, [open, track]);

  const timed = useMemo(() => lyrics?.synced ? parseLrc(lyrics.content) : [], [lyrics]);
  const plain = useMemo(() => lyrics && !lyrics.synced ? plainLines(lyrics.content) : [], [lyrics]);
  const active = timed.length ? activeIndex(timed, currentTime) : -1;

  useEffect(() => {
    if (active >= 0) lineRefs.current[active]?.scrollIntoView({ block: 'center', behavior: 'smooth' });
  }, [active]);

  useEffect(() => {
    if (!open) return;
    const close = (event: KeyboardEvent) => { if (event.key === 'Escape') setOpen(false); };
    window.addEventListener('keydown', close);
    return () => window.removeEventListener('keydown', close);
  }, [open, setOpen]);

  if (!open || !track) return null;
  const style = { '--now-accent': palette.accent, '--now-deep': palette.deep, '--now-glow': palette.glow } as CSSProperties;

  return (
    <section className="now-playing" style={style} aria-label="正在播放">
      <div className="now-playing__ambient" aria-hidden="true" />
      <header className="now-playing__header">
        <button type="button" className="round-button" aria-label="關閉正在播放" onClick={() => setOpen(false)}><IconChevronDown /></button>
        <span className="now-playing__label">
          <span>NOW PLAYING</span>
          {isDolbyAtmos(track) ? <DolbyLogo variant="atmos" className="now-playing__dolby" /> : <span>· {qualityParts(track).join(' · ') || 'ORIGINAL AUDIO'}</span>}
        </span>
        <LikeButton track={track} />
      </header>
      <div className="now-playing__layout">
        <div className="now-playing__visual">
          <Artwork artworkId={track.artworkId} title={track.title} artist={track.artist} className="now-playing__art" loading="eager" />
          <div className="now-playing__meta"><div><h1>{track.title}</h1><p>{track.artist} · {track.album}</p></div></div>
          <Range value={currentTime} max={duration} onChange={seek} label="播放進度" />
          <div className="now-playing__time"><span>{formatTime(currentTime)}</span><span>-{formatTime(Math.max(0, duration - currentTime))}</span></div>
          <CoreControls large />
        </div>
        <div className="lyrics-panel" data-lenis-prevent>
          <div className="lyrics-panel__heading"><span className="eyebrow">LYRICS</span><h2>同步歌詞</h2></div>
          {loading ? <div className="lyrics-skeleton"><span /><span /><span /><span /></div> : null}
          {!loading && !lyrics ? <div className="lyrics-empty"><IconLyrics size={28} /><p>這首歌還沒有歌詞</p><small>下次同步時會讀取內嵌歌詞或同名 LRC 檔。</small></div> : null}
          {timed.length ? <div className="lyrics-lines">{timed.map((line, index) => (
            <button type="button" key={`${line.time}-${index}`} ref={(node) => { lineRefs.current[index] = node; }} className={index === active ? 'is-active' : ''} onClick={() => seek(line.time)}>{line.text || '♪'}</button>
          ))}</div> : null}
          {plain.length ? <div className="lyrics-lines lyrics-lines--plain">{plain.map((line, index) => <p key={`${line}-${index}`}>{line || <br />}</p>)}</div> : null}
        </div>
      </div>
    </section>
  );
}
