import { useEffect, useLayoutEffect, useRef, useState, type MouseEvent } from 'react';
import { useMatch, useNavigate } from 'react-router-dom';
import { api } from '../api/client';
import type { Track } from '../api/types';
import { formatTime, isDolbyAtmos, qualityLabel, trackArtists } from '../lib/format';
import { useIsLiked, useLikes } from '../store/likes';
import { useCurrentTrack, usePlayer } from '../store/player';
import { useSession } from '../store/session';
import { toast } from '../store/toast';
import { Artwork } from './Artwork';
import { AtmosMark, hasAtmosMark } from './DolbyLogo';
import {
  IconCheck,
  IconDisc,
  IconHeart,
  IconHeartFill,
  IconMic,
  IconMore,
  IconNextUp,
  IconPlay,
  IconPlaylistAdd,
  IconQueue,
  IconTrash,
  IconWave,
} from './Icons';

function closeMenu(event: MouseEvent<HTMLElement>) {
  event.currentTarget.closest('details')?.removeAttribute('open');
}

const MENU_OFFSET = 36;

function visibleEdge(selector: string, edge: 'top' | 'bottom') {
  const rect = document.querySelector(selector)?.getBoundingClientRect();
  return rect && rect.height > 0 ? rect[edge] : undefined;
}

function menuPlacement(details: HTMLElement, popover: HTMLElement): 'above' | 'below' {
  const trigger = details.getBoundingClientRect();
  const limitTop = visibleEdge('.topbar', 'bottom') ?? 0;
  const limitBottom = Math.min(
    window.innerHeight,
    ...['.player-bar', '.mobile-nav'].map((selector) => visibleEdge(selector, 'top') ?? Infinity),
  );
  const spaceAbove = trigger.bottom - MENU_OFFSET - limitTop;
  const spaceBelow = limitBottom - (trigger.top + MENU_OFFSET);
  return spaceAbove >= popover.offsetHeight || spaceAbove >= spaceBelow ? 'above' : 'below';
}

export function LikeButton({ track, className = '' }: { track: Track; className?: string }) {
  const liked = useIsLiked(track);
  const toggle = useLikes((s) => s.toggle);
  return (
    <button
      type="button"
      className={`icon-button ${liked ? 'is-active' : ''} ${className}`}
      aria-label={liked ? `取消喜愛 ${track.title}` : `喜愛 ${track.title}`}
      aria-pressed={liked}
      onClick={() => void toggle(track)}
    >
      {liked ? <IconHeartFill size={18} /> : <IconHeart size={18} />}
    </button>
  );
}

function TrackMenu({ track, onRemove }: { track: Track; onRemove?: () => void }) {
  const detailsRef = useRef<HTMLDetailsElement>(null);
  const [open, setOpen] = useState(false);
  const [placement, setPlacement] = useState<'above' | 'below' | null>(null);
  const playlists = useSession((s) => s.playlists);
  const refreshPlaylists = useSession((s) => s.refreshPlaylists);
  const playNext = usePlayer((s) => s.playNext);
  const addToQueue = usePlayer((s) => s.addToQueue);
  const navigate = useNavigate();
  const albumMatch = useMatch('/album/:id');
  const showGoToAlbum = track.albumId !== null && albumMatch?.params.id !== String(track.albumId);
  const artistMatch = useMatch('/artist/:id/*');
  const credited = trackArtists(track);
  const goToArtists = credited.filter((artist) => artistMatch?.params.id !== String(artist.id));

  useLayoutEffect(() => {
    const details = detailsRef.current;
    const popover = details?.querySelector<HTMLElement>('.menu-popover');
    setPlacement(open && details && popover ? menuPlacement(details, popover) : null);
  }, [open]);

  useEffect(() => {
    if (!open) return;

    function handlePointerDown(event: PointerEvent) {
      const details = detailsRef.current;
      if (details && !details.contains(event.target as Node)) details.removeAttribute('open');
    }

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key !== 'Escape') return;
      const details = detailsRef.current;
      if (!details) return;
      details.removeAttribute('open');
      details.querySelector('summary')?.focus();
    }

    document.addEventListener('pointerdown', handlePointerDown);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('pointerdown', handlePointerDown);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [open]);

  async function addToPlaylist(playlistId: number, event: MouseEvent<HTMLButtonElement>) {
    closeMenu(event);
    try {
      await api.addToPlaylist(playlistId, [track.id]);
      await refreshPlaylists();
      toast('已加入播放清單');
    } catch (error) {
      toast((error as Error).message, 'error');
    }
  }

  return (
    <details ref={detailsRef} className="track-menu" data-placement={placement ?? undefined} onToggle={(event) => setOpen(event.currentTarget.open)}>
      <summary className="icon-button" aria-label={`${track.title} 的更多選項`}><IconMore size={19} /></summary>
      <div className="menu-popover">
        <button type="button" onClick={(event) => { closeMenu(event); playNext([track]); toast('下一首播放'); }}>
          <IconNextUp size={18} />下一首播放
        </button>
        <button type="button" onClick={(event) => { closeMenu(event); addToQueue([track]); toast('已加入佇列'); }}>
          <IconQueue size={18} />加入播放佇列
        </button>
        {showGoToAlbum ? (
          <button type="button" onClick={(event) => { closeMenu(event); navigate(`/album/${track.albumId}`); }}>
            <IconDisc size={18} />前往專輯
          </button>
        ) : null}
        {goToArtists.map((artist) => (
          <button key={artist.id} type="button" onClick={(event) => { closeMenu(event); navigate(`/artist/${artist.id}`, { state: { pageTitle: artist.name } }); }}>
            <IconMic size={18} />{credited.length > 1 ? `前往 ${artist.name}` : '前往藝人'}
          </button>
        ))}
        {playlists.length ? <span className="menu-popover__label">加入播放清單</span> : null}
        {playlists.slice(0, 8).map((playlist) => {
          const added = playlist.trackIds?.includes(track.id) ?? false;
          return (
            <button type="button" key={playlist.id} disabled={added} aria-label={added ? `已加入「${playlist.name}」` : undefined} onClick={(event) => void addToPlaylist(playlist.id, event)}>
              {added ? <IconCheck size={18} /> : <IconPlaylistAdd size={18} />}{playlist.name}
            </button>
          );
        })}
        {onRemove ? (
          <button type="button" className="menu-popover__danger" onClick={(event) => { closeMenu(event); onRemove(); }}>
            <IconTrash size={18} />從清單移除
          </button>
        ) : null}
      </div>
    </details>
  );
}

interface TrackListProps {
  tracks: Track[];
  numbered?: boolean;
  compact?: boolean;
  showMetadata?: boolean;
  onRemove?: (track: Track) => void;
}

export function TrackList({ tracks, numbered = true, compact = false, showMetadata = true, onRemove }: TrackListProps) {
  const current = useCurrentTrack();
  const isPlaying = usePlayer((s) => s.isPlaying);
  const playList = usePlayer((s) => s.playList);
  const toggle = usePlayer((s) => s.toggle);
  const signedIn = useSession((s) => Boolean(s.user));

  return (
    <div className={`track-list ${compact ? 'track-list--compact' : ''}`} role="list">
      {tracks.map((track, index) => {
        const active = current?.id === track.id;
        const quality = qualityLabel(track);
        return (
          <div className={`track-row ${active ? 'is-current' : ''}${signedIn ? '' : ' track-row--guest'}`} role="listitem" key={track.entryId ?? track.id}>
            <button
              type="button"
              className="track-row__main"
              aria-label={`${active && isPlaying ? '暫停' : '播放'} ${track.title}，${track.artist}`}
              onClick={() => active ? toggle() : playList(tracks, index)}
            >
              <span className="track-row__index" aria-hidden="true">
                {active && isPlaying ? <IconWave size={19} /> : numbered ? <span>{String(index + 1).padStart(2, '0')}</span> : <IconPlay size={14} />}
              </span>
              <Artwork artworkId={track.artworkId} title={track.title} artist={track.artist} className="track-row__art" />
              <span className="track-row__copy">
                <strong>{track.title}</strong>
                {showMetadata ? <small>{track.artist}<span aria-hidden="true"> · </span>{track.album}</small> : null}
              </span>
            </button>
            <span className="track-row__quality">
              {isDolbyAtmos(track)
                ? hasAtmosMark(track.hasAac51) ? <span className="quality-badge quality-badge--dolby"><AtmosMark hasAac51={track.hasAac51} /></span> : null
                : quality ? <span className="quality-badge">{quality}</span> : null}
            </span>
            <span className="track-row__duration">{formatTime(track.duration)}</span>
            {signedIn ? <LikeButton track={track} /> : null}
            {signedIn ? <TrackMenu track={track} onRemove={onRemove ? () => onRemove(track) : undefined} /> : null}
          </div>
        );
      })}
    </div>
  );
}
