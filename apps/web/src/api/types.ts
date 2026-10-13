export interface User {
  id: number;
  username: string;
  role: 'admin' | 'user';
}

export interface ManagedUser extends User {
  createdAt: number;
}

export interface Track {
  id: number;
  title: string;
  artist: string;
  artistId: number | null;
  album: string;
  albumId: number | null;
  trackNo: number | null;
  discNo: number | null;
  year: number | null;
  genre: string | null;
  duration: number;
  codec: string | null;
  bitrate: number | null;
  sampleRate: number | null;
  bitDepth: number | null;
  channels: number | null;
  artworkId: string | null;
  hasLyrics: boolean;
  addedAt: number;
  liked: boolean;
  entryId?: number;
}

export interface ManagedTrack extends Track {
  visible: boolean;
}

export interface ManagedTrackStats {
  total: number;
  visible: number;
  hidden: number;
}

export interface Album {
  id: number;
  title: string;
  year: number | null;
  artworkId: string | null;
  artistId: number;
  artist: string;
  trackCount: number;
  duration: number;
  addedAt: number;
  genre: string | null;
  recordLabel: string | null;
  lossless: boolean;
  atmos: boolean;
}

export interface Artist {
  id: number;
  name: string;
  artworkId: string | null;
  trackCount?: number;
}

export interface Playlist {
  id: number;
  name: string;
  description: string | null;
  updatedAt: number;
  trackCount: number;
  duration: number;
  artworkId: string | null;
}

export interface LibraryStats {
  tracks: number;
  bytes: number;
  seconds: number;
  lossless: number;
  albums: number;
  artists: number;
  with_lyrics: number;
}

export interface HomeData {
  recentAlbums: Album[];
  recentPlays: Track[];
  randomAlbums: Album[];
  quickPicks: Track[];
  stats: LibraryStats;
}

export interface Lyrics {
  content: string;
  synced: boolean;
  source: 'embedded' | 'lrc';
}

export interface SyncStatus {
  root: string;
  ready: number;
  pending: number;
  errorCount: number;
  errors: { id: number; path: string; error: string }[];
}
