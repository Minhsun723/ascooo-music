import { Link } from 'react-router-dom';
import type { Album, Artist, Playlist } from '../api/types';
import { formatLongDuration } from '../lib/format';
import { Artwork } from './Artwork';
import { DolbyLogo } from './DolbyLogo';

type MediaItem =
  | { kind: 'album'; data: Album }
  | { kind: 'artist'; data: Artist }
  | { kind: 'playlist'; data: Playlist };

export function MediaCard({ item }: { item: MediaItem }) {
  if (item.kind === 'artist') {
    const artist = item.data;
    return (
      <Link className="media-card media-card--artist" to={`/artist/${artist.id}`} state={{ pageTitle: artist.name }}>
        <div className="media-card__art">
          <Artwork artworkId={artist.artworkId} title={artist.name} rounded="circle" />
        </div>
        <span className="media-card__title">{artist.name}</span>
        <span className="media-card__meta">藝人{artist.trackCount ? ` · ${artist.trackCount} 首歌` : ''}</span>
      </Link>
    );
  }

  if (item.kind === 'playlist') {
    const playlist = item.data;
    return (
      <Link className="media-card" to={`/playlist/${playlist.id}`}>
        <div className="media-card__art">
          <Artwork artworkId={playlist.artworkId} title={playlist.name} />
        </div>
        <span className="media-card__title">{playlist.name}</span>
        <span className="media-card__meta">{playlist.trackCount} 首歌 · {formatLongDuration(playlist.duration)}</span>
      </Link>
    );
  }

  const album = item.data;
  return (
    <Link className="media-card" to={`/album/${album.id}`} state={{ pageTitle: album.title }}>
      <div className="media-card__art">
        <Artwork artworkId={album.artworkId} title={album.title} artist={album.artist} />
        {album.atmos
          ? <span className="media-card__badge media-card__badge--dolby"><DolbyLogo /></span>
          : album.lossless ? <span className="media-card__badge quality-badge">LOSSLESS</span> : null}
      </div>
      <span className="media-card__title">{album.title}</span>
      <span className="media-card__meta">{album.artist}{album.year ? ` · ${album.year}` : ''}</span>
    </Link>
  );
}

export function AlbumGrid({ albums }: { albums: Album[] }) {
  return <div className="media-grid">{albums.map((album) => <MediaCard key={album.id} item={{ kind: 'album', data: album }} />)}</div>;
}

export function ArtistGrid({ artists }: { artists: Artist[] }) {
  return <div className="media-grid media-grid--artists">{artists.map((artist) => <MediaCard key={artist.id} item={{ kind: 'artist', data: artist }} />)}</div>;
}

export function PlaylistGrid({ playlists }: { playlists: Playlist[] }) {
  return <div className="media-grid">{playlists.map((playlist) => <MediaCard key={playlist.id} item={{ kind: 'playlist', data: playlist }} />)}</div>;
}
