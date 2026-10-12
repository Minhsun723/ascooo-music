import type { MouseEvent } from 'react';
import { api } from '../api/client';
import type { Track } from '../api/types';
import { formatTime, isDolbyAtmos, isHiRes, isLossless } from '../lib/format';
import { useIsLiked, useLikes } from '../store/likes';
import { useCurrentTrack, usePlayer } from '../store/player';
import { useSession } from '../store/session';
import { toast } from '../store/toast';
import { Artwork } from './Artwork';
import { DolbyLogo } from './DolbyLogo';
import {
  IconHeart,
  IconHeartFill,
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
  const playlists = useSession((s) => s.playlists);
  const refreshPlaylists = useSession((s) => s.refreshPlaylists);
  const playNext = usePlayer((s) => s.playNext);
  const addToQueue = usePlayer((s) => s.addToQueue);

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
    <details className="track-menu">
      <summary className="icon-button" aria-label={`${track.title} 的更多選項`}><IconMore size={19} /></summary>
      <div className="menu-popover">
        <button type="button" onClick={(event) => { closeMenu(event); playNext([track]); toast('下一首播放'); }}>
          <IconNextUp size={18} />下一首播放
        </button>
        <button type="button" onClick={(event) => { closeMenu(event); addToQueue([track]); toast('已加入佇列'); }}>
          <IconQueue size={18} />加入播放佇列
        </button>
        {playlists.length ? <span className="menu-popover__label">加入播放清單</span> : null}
        {playlists.slice(0, 8).map((playlist) => (
          <button type="button" key={playlist.id} onClick={(event) => void addToPlaylist(playlist.id, event)}>
            <IconPlaylistAdd size={18} />{playlist.name}
          </button>
        ))}
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
  onRemove?: (track: Track) => void;
}

export function TrackList({ tracks, numbered = true, compact = false, onRemove }: TrackListProps) {
  const current = useCurrentTrack();
  const isPlaying = usePlayer((s) => s.isPlaying);
  const playList = usePlayer((s) => s.playList);
  const toggle = usePlayer((s) => s.toggle);

  return (
    <div className={`track-list ${compact ? 'track-list--compact' : ''}`} role="list">
      {tracks.map((track, index) => {
        const active = current?.id === track.id;
        return (
          <div className={`track-row ${active ? 'is-current' : ''}`} role="listitem" key={track.entryId ?? track.id}>
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
                <small>{track.artist}<span aria-hidden="true"> · </span>{track.album}</small>
              </span>
            </button>
            <span className="track-row__quality">
              {isDolbyAtmos(track)
                ? <span className="quality-badge quality-badge--dolby"><DolbyLogo /></span>
                : isHiRes(track) ? <span className="quality-badge">HI-RES</span> : isLossless(track) ? <span className="quality-badge">LOSSLESS</span> : null}
            </span>
            <span className="track-row__duration">{formatTime(track.duration)}</span>
            <LikeButton track={track} />
            <TrackMenu track={track} onRemove={onRemove ? () => onRemove(track) : undefined} />
          </div>
        );
      })}
    </div>
  );
}
