/** Shared SQL fragments that shape rows into the API's Track JSON. */

export const TRACK_SELECT = `
  t.id, t.title, t.artist, t.artist_id, t.album_id, al.title AS album, aa.name AS album_artist,
  t.track_no, t.disc_no, t.year, t.genre, t.duration, t.codec, t.bitrate, t.sample_rate,
  t.bit_depth, t.channels, COALESCE(t.artwork_id, al.artwork_id) AS artwork_id, t.has_lyrics,
  t.added_at, CASE WHEN f.track_id IS NULL THEN 0 ELSE 1 END AS liked
`;

/** Joins used with TRACK_SELECT. Bind the current user id as the first parameter. */
export const TRACK_JOINS = `
  LEFT JOIN albums al ON al.id = t.album_id
  LEFT JOIN artists aa ON aa.id = al.artist_id
  LEFT JOIN favorites f ON f.track_id = t.id AND f.user_id = ?
`;

export interface TrackRow {
  id: number;
  title: string;
  artist: string | null;
  artist_id: number | null;
  album_id: number | null;
  album: string | null;
  album_artist: string | null;
  track_no: number | null;
  disc_no: number | null;
  year: number | null;
  genre: string | null;
  duration: number | null;
  codec: string | null;
  bitrate: number | null;
  sample_rate: number | null;
  bit_depth: number | null;
  channels: number | null;
  artwork_id: string | null;
  has_lyrics: number;
  added_at: number;
  liked: number;
}

export function toTrack(r: TrackRow) {
  return {
    id: r.id,
    title: r.title,
    artist: r.artist ?? r.album_artist ?? '未知歌手',
    artistId: r.artist_id,
    album: r.album ?? '',
    albumId: r.album_id,
    trackNo: r.track_no,
    discNo: r.disc_no,
    year: r.year,
    genre: r.genre,
    duration: r.duration ?? 0,
    codec: r.codec,
    bitrate: r.bitrate,
    sampleRate: r.sample_rate,
    bitDepth: r.bit_depth,
    channels: r.channels,
    artworkId: r.artwork_id,
    hasLyrics: !!r.has_lyrics,
    addedAt: r.added_at,
    liked: !!r.liked,
  };
}

export const ALBUM_SELECT = `
  al.id, al.title, al.year, al.artwork_id, al.artist_id, ar.name AS artist,
  COUNT(t.id) AS track_count, COALESCE(SUM(t.duration), 0) AS duration,
  MAX(t.added_at) AS added_at,
  MAX(CASE WHEN t.codec IN ('flac','alac','wav') THEN 1 ELSE 0 END) AS lossless,
  MAX(CASE WHEN LOWER(t.codec) IN ('ec-3','eac3','e-ac-3') THEN 1 ELSE 0 END) AS atmos
`;

export const ALBUM_FROM = `
  FROM albums al
  JOIN artists ar ON ar.id = al.artist_id
  JOIN tracks t ON t.album_id = al.id AND t.status = 'ready'
`;

export interface AlbumRow {
  id: number;
  title: string;
  year: number | null;
  artwork_id: string | null;
  artist_id: number;
  artist: string;
  track_count: number;
  duration: number;
  added_at: number;
  lossless: number;
  atmos: number;
}

export function toAlbum(r: AlbumRow) {
  return {
    id: r.id,
    title: r.title,
    year: r.year,
    artworkId: r.artwork_id,
    artistId: r.artist_id,
    artist: r.artist,
    trackCount: r.track_count,
    duration: r.duration,
    addedAt: r.added_at,
    lossless: !!r.lossless,
    atmos: !!r.atmos,
  };
}

export const likePattern = (q: string) => `%${q.replace(/[\\%_]/g, (m) => '\\' + m)}%`;
