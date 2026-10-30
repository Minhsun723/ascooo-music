export interface User {
  id: number;
  username: string;
  role: 'admin' | 'user';
}

export interface ManagedUser extends User {
  createdAt: number;
}

export interface ArtistCredit {
  id: number;
  name: string;
}

export interface Track {
  id: number;
  title: string;
  /** The whole credit line, e.g. "Shawn Mendes & Camila Cabello". */
  artist: string;
  /** Every credited artist, in credit order. Missing on queues saved before it existed; read it through trackArtists(). */
  artists?: ArtistCredit[];
  /** The first credited artist. */
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
  /** An AAC 5.1 copy exists for browsers that cannot decode Dolby Atmos. Missing on queues saved before it existed. */
  hasAac51?: boolean;
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
  /** The first credited artist. */
  artistId: number;
  artist: string;
  /** Every credited artist, in credit order. Missing on responses cached before it existed. */
  artists?: ArtistCredit[];
  trackCount: number;
  duration: number;
  addedAt: number;
  genre: string | null;
  recordLabel: string | null;
  lossless: boolean;
  atmos: boolean;
  /** Some Atmos track on the album has an AAC 5.1 copy. Missing on responses cached before it existed. */
  aac51?: boolean;
  /** The album's copyright line exactly as tagged. Only on the album detail response. */
  copyright?: string | null;
  /** Release day as YYYY-MM-DD. Only on the album detail response. */
  releaseDate?: string | null;
}

export interface Artist {
  id: number;
  name: string;
  artworkId: string | null;
  /** Apple Music's logo for the artist, on a transparent background. Only on the artist detail response. */
  logoId?: string | null;
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
  trackIds: number[];
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
  source: 'embedded' | 'lrc' | 'ttml' | 'apple-music';
  format: 'plain' | 'lrc' | 'ttml';
}

export interface SyncStatus {
  root: string;
  ready: number;
  pending: number;
  errorCount: number;
  errors: { id: number; path: string; error: string }[];
}
