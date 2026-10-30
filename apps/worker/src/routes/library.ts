import { Hono } from 'hono';
import { HTTPException } from 'hono/http-exception';
import type { Context } from 'hono';
import type { AppEnv } from '../env';
import { requireAdmin } from '../lib/auth';
import { anonymousEdgeCache } from '../lib/edge-cache';
import { searchPatterns } from '../lib/search-query';
import {
  ALBUM_FROM,
  ALBUM_SELECT,
  type AlbumRow,
  genreOf,
  TRACK_JOINS,
  TRACK_SELECT,
  type TrackRow,
  toAlbum,
  toTrack,
} from '../lib/sql';

/** Browsing routes open to signed-out visitors; mounted ahead of requireUser. */
export const catalog = new Hono<AppEnv>();
const library = new Hono<AppEnv>();

/** Signed-out visitors have no likes or history, so user id 0 matches no rows. */
const viewerId = (c: Context<AppEnv>) => c.get('user')?.id ?? 0;

const int = (v: string | undefined, def: number, max = 500) => {
  const n = parseInt(v ?? '', 10);
  return Number.isFinite(n) && n >= 0 ? Math.min(n, max) : def;
};

function shuffledTake<T>(items: T[], limit: number): T[] {
  for (let i = items.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [items[i], items[j]] = [items[j], items[i]];
  }
  return items.slice(0, limit);
}

const TRACK_SORTS: Record<string, string> = {
  added: 't.added_at DESC, t.id DESC',
  title: 'COALESCE(t.display_title, t.title) COLLATE NOCASE ASC',
  artist: 'COALESCE(t.display_artist, t.artist) COLLATE NOCASE ASC, al.title COLLATE NOCASE, t.disc_no, t.track_no',
  album: 'al.title COLLATE NOCASE ASC, t.disc_no, t.track_no',
  duration: 't.duration DESC',
};

/** Cover of an album credited to `ar`, for an artist without a photo. */
const ALBUM_ARTWORK_OF_ARTIST = `(SELECT al.artwork_id FROM album_artists ala JOIN albums al ON al.id = ala.album_id
  WHERE ala.artist_id = ar.id AND al.artwork_id IS NOT NULL LIMIT 1)`;

const ALBUM_SORTS: Record<string, string> = {
  added: 'added_at DESC',
  title: 'al.title COLLATE NOCASE ASC',
  artist: 'COALESCE(ar.display_name, ar.name) COLLATE NOCASE ASC, al.year',
  year: 'al.year DESC',
};

catalog.get('/home', anonymousEdgeCache, async (c) => {
  const uid = viewerId(c);
  const db = c.env.DB;
  const [trackBound, albumBound] = await db.batch([
    db.prepare("SELECT MAX(id) AS max_id FROM tracks WHERE status = 'ready' AND visible = 1"),
    db.prepare(
      `SELECT MAX(al.id) AS max_id FROM albums al WHERE EXISTS (
         SELECT 1 FROM tracks t WHERE t.album_id = al.id AND t.status = 'ready' AND t.visible = 1
       )`,
    ),
  ]);
  const randomStart = (result: D1Result) => {
    const max = Number((result.results[0] as { max_id: number | null } | undefined)?.max_id ?? 0);
    return max > 0 ? Math.floor(Math.random() * max) + 1 : 0;
  };
  const trackStart = randomStart(trackBound);
  const albumStart = randomStart(albumBound);
  const randomAlbumQuery = (comparison: '>=' | '<') => db.prepare(
    `WITH picked AS (
       SELECT al.id FROM albums al
       WHERE al.id ${comparison} ? AND EXISTS (
         SELECT 1 FROM tracks et WHERE et.album_id = al.id AND et.status = 'ready' AND et.visible = 1
       )
       ORDER BY al.id LIMIT 24
     )
     SELECT ${ALBUM_SELECT}
     FROM picked p
     JOIN albums al ON al.id = p.id
     JOIN artists ar ON ar.id = al.artist_id
     JOIN tracks t ON t.album_id = al.id AND t.status = 'ready' AND t.visible = 1
     GROUP BY al.id ORDER BY al.id`,
  ).bind(albumStart);
  const randomTrackQuery = (comparison: '>=' | '<') => db.prepare(
    `SELECT ${TRACK_SELECT} FROM tracks t ${TRACK_JOINS}
     WHERE t.status = 'ready' AND t.visible = 1 AND t.id ${comparison} ?
     ORDER BY t.id LIMIT 100`,
  ).bind(uid, trackStart);

  // Signed-out visitors have no play history; skip the query instead of reading zero rows.
  const recentPlaysQuery = uid ? db.prepare(
    `SELECT ${TRACK_SELECT} FROM play_stats h JOIN tracks t ON t.id = h.track_id ${TRACK_JOINS}
     WHERE h.user_id = ? AND t.status = 'ready' AND t.visible = 1
     ORDER BY h.last_played DESC LIMIT 16`,
  ).bind(uid, uid) : null;

  const [recentAlbums, randomAlbumsAfter, randomAlbumsBefore, randomTracksAfter, randomTracksBefore, stats, recentPlays] = await db.batch([
    db.prepare(`SELECT ${ALBUM_SELECT} ${ALBUM_FROM} GROUP BY al.id ORDER BY added_at DESC LIMIT 12`),
    randomAlbumQuery('>='),
    randomAlbumQuery('<'),
    randomTrackQuery('>='),
    randomTrackQuery('<'),
    db.prepare(
      `WITH visible_tracks AS (
         SELECT id, album_id, artist_id, size, duration, codec, has_lyrics
         FROM tracks WHERE status = 'ready' AND visible = 1
       ), library_artists AS (
         SELECT ta.artist_id FROM visible_tracks vt JOIN track_artists ta ON ta.track_id = vt.id
         UNION
         SELECT ala.artist_id FROM visible_tracks vt JOIN album_artists ala ON ala.album_id = vt.album_id
       )
       SELECT COUNT(*) AS tracks, COALESCE(SUM(size),0) AS bytes, COALESCE(SUM(duration),0) AS seconds,
        COALESCE(SUM(CASE WHEN codec IN ('flac','alac','wav') THEN 1 ELSE 0 END), 0) AS lossless,
        COUNT(DISTINCT album_id) AS albums,
        (SELECT COUNT(*) FROM library_artists) AS artists,
        COALESCE(SUM(has_lyrics), 0) AS with_lyrics
       FROM visible_tracks`,
    ),
    ...(recentPlaysQuery ? [recentPlaysQuery] : []),
  ]);
  const randomAlbums = shuffledTake([
    ...(randomAlbumsAfter.results as AlbumRow[]),
    ...(randomAlbumsBefore.results as AlbumRow[]),
  ], 12);
  const randomTracks = shuffledTake([
    ...(randomTracksAfter.results as TrackRow[]),
    ...(randomTracksBefore.results as TrackRow[]),
  ], 20);
  return c.json({
    recentAlbums: (recentAlbums.results as AlbumRow[]).map(toAlbum),
    recentPlays: recentPlays ? (recentPlays.results as TrackRow[]).map(toTrack) : [],
    randomAlbums: randomAlbums.map(toAlbum),
    quickPicks: randomTracks.map(toTrack),
    stats: stats.results[0],
  });
});

catalog.get('/tracks', anonymousEdgeCache, async (c) => {
  const uid = viewerId(c);
  const sort = TRACK_SORTS[c.req.query('sort') ?? 'added'] ?? TRACK_SORTS.added;
  const limit = int(c.req.query('limit'), 100);
  const offset = int(c.req.query('offset'), 0, 1e9);
  const { results } = await c.env.DB.prepare(
    `SELECT ${TRACK_SELECT} FROM tracks t ${TRACK_JOINS} WHERE t.status = 'ready' AND t.visible = 1 ORDER BY ${sort} LIMIT ? OFFSET ?`,
  )
    .bind(uid, limit, offset)
    .all<TrackRow>();
  const total = await c.env.DB.prepare("SELECT COUNT(*) AS n FROM tracks WHERE status = 'ready' AND visible = 1").first<{ n: number }>();
  return c.json({ tracks: results.map(toTrack), total: total?.n ?? 0 });
});

catalog.get('/albums', anonymousEdgeCache, async (c) => {
  const sort = ALBUM_SORTS[c.req.query('sort') ?? 'added'] ?? ALBUM_SORTS.added;
  const limit = int(c.req.query('limit'), 100);
  const offset = int(c.req.query('offset'), 0, 1e9);
  const { results } = await c.env.DB.prepare(
    `SELECT ${ALBUM_SELECT} ${ALBUM_FROM} GROUP BY al.id ORDER BY ${sort} LIMIT ? OFFSET ?`,
  )
    .bind(limit, offset)
    .all<AlbumRow>();
  return c.json({ albums: results.map(toAlbum) });
});

catalog.get('/albums/:id', anonymousEdgeCache, async (c) => {
  const uid = viewerId(c);
  const id = Number(c.req.param('id'));
  const db = c.env.DB;
  const album = await db.prepare(`SELECT ${ALBUM_SELECT} ${ALBUM_FROM} WHERE al.id = ? GROUP BY al.id`).bind(id).first<AlbumRow>();
  if (!album) throw new HTTPException(404, { message: '找不到這張專輯' });
  // Tracks on one album normally share these values; take the most common so one odd tag cannot win.
  const mostCommon = (column: 'copyright' | 'release_date' | 'genre', value: string = column) =>
    `(SELECT ${value} FROM tracks WHERE album_id = ?1 AND status = 'ready' AND visible = 1 AND ${value} IS NOT NULL
      GROUP BY ${value} ORDER BY COUNT(*) DESC, ${value} LIMIT 1) AS ${column}`;
  const [tracks, more, credits] = await db.batch([
    db.prepare(
      `SELECT ${TRACK_SELECT} FROM tracks t ${TRACK_JOINS} WHERE t.album_id = ? AND t.status = 'ready' AND t.visible = 1
       ORDER BY COALESCE(t.disc_no, 1), COALESCE(t.track_no, 9999), t.title`,
    ).bind(uid, id),
    db.prepare(
      `SELECT ${ALBUM_SELECT} ${ALBUM_FROM}
       WHERE al.id IN (SELECT album_id FROM album_artists WHERE artist_id = ?) AND al.id != ?
       GROUP BY al.id ORDER BY al.year DESC LIMIT 12`,
    ).bind(album.artist_id, id),
    db.prepare(
      `SELECT ${mostCommon('copyright')}, ${mostCommon('release_date')}, ${mostCommon('genre', genreOf('tracks'))}`,
    ).bind(id),
  ]);
  const credit = credits.results[0] as
    | { copyright: string | null; release_date: string | null; genre: string | null }
    | undefined;
  return c.json({
    album: {
      ...toAlbum(album),
      genre: credit?.genre ?? null,
      copyright: credit?.copyright ?? null,
      releaseDate: credit?.release_date ?? null,
    },
    tracks: (tracks.results as TrackRow[]).map(toTrack),
    moreByArtist: (more.results as AlbumRow[]).map(toAlbum),
  });
});

catalog.get('/artists', anonymousEdgeCache, async (c) => {
  const limit = int(c.req.query('limit'), 200);
  const offset = int(c.req.query('offset'), 0, 1e9);
  const { results } = await c.env.DB.prepare(
    `WITH artist_tracks AS (
       SELECT ta.artist_id, t.id AS track_id
       FROM track_artists ta JOIN tracks t ON t.id = ta.track_id
       WHERE t.status = 'ready' AND t.visible = 1
       UNION
       SELECT ala.artist_id, t.id AS track_id
       FROM album_artists ala JOIN tracks t ON t.album_id = ala.album_id
       WHERE t.status = 'ready' AND t.visible = 1
     ), artist_counts AS (
       SELECT artist_id, COUNT(*) AS track_count FROM artist_tracks GROUP BY artist_id
     )
     SELECT ar.id, COALESCE(ar.display_name, ar.name) AS name, ac.track_count,
       COALESCE(ar.artwork_id, ${ALBUM_ARTWORK_OF_ARTIST}) AS artwork_id
     FROM artist_counts ac JOIN artists ar ON ar.id = ac.artist_id
     ORDER BY COALESCE(ar.display_name, ar.name) COLLATE NOCASE LIMIT ? OFFSET ?`,
  )
    .bind(limit, offset)
    .all<{ id: number; name: string; track_count: number; artwork_id: string | null }>();
  return c.json({
    artists: results.map((r) => ({ id: r.id, name: r.name, trackCount: r.track_count, artworkId: r.artwork_id })),
  });
});

/** Songs an artist is credited on, and every song on the albums they are credited on. */
const ARTIST_TRACK_IDS = `artist_track_ids AS (
  SELECT t.id FROM track_artists ta CROSS JOIN tracks t ON t.id = ta.track_id
  WHERE ta.artist_id = ? AND t.status = 'ready' AND t.visible = 1
  UNION
  SELECT t.id FROM album_artists ala CROSS JOIN tracks t ON t.album_id = ala.album_id
  WHERE ala.artist_id = ? AND t.status = 'ready' AND t.visible = 1
)`;

async function findArtist(db: D1Database, id: number) {
  const artist = await db.prepare(
    `SELECT ar.id, COALESCE(ar.display_name, ar.name) AS name, ar.artwork_id, ar.logo_artwork_id FROM artists ar WHERE ar.id = ? AND (
       EXISTS (SELECT 1 FROM track_artists ta CROSS JOIN tracks t ON t.id = ta.track_id
               WHERE ta.artist_id = ar.id AND t.status = 'ready' AND t.visible = 1)
       OR EXISTS (SELECT 1 FROM album_artists ala CROSS JOIN tracks t ON t.album_id = ala.album_id
                  WHERE ala.artist_id = ar.id AND t.status = 'ready' AND t.visible = 1)
     )`,
  ).bind(id).first<{ id: number; name: string; artwork_id: string | null; logo_artwork_id: string | null }>();
  if (!artist) throw new HTTPException(404, { message: '找不到這位歌手' });
  return artist;
}

catalog.get('/artists/:id', anonymousEdgeCache, async (c) => {
  const uid = viewerId(c);
  const id = Number(c.req.param('id'));
  const db = c.env.DB;
  const artist = await findArtist(db, id);
  const [albums, top] = await db.batch([
    db.prepare(
      `SELECT ${ALBUM_SELECT} ${ALBUM_FROM}
       WHERE al.id IN (SELECT album_id FROM album_artists WHERE artist_id = ?)
       GROUP BY al.id ORDER BY al.year DESC, al.title`,
    ).bind(id),
    db.prepare(
      `WITH ${ARTIST_TRACK_IDS}
       SELECT ${TRACK_SELECT}, COALESCE(SUM(ps.play_count), 0) AS plays
       FROM artist_track_ids ati JOIN tracks t ON t.id = ati.id ${TRACK_JOINS}
       LEFT JOIN play_stats ps ON ps.track_id = t.id
       GROUP BY t.id
       ORDER BY plays DESC, t.added_at DESC LIMIT 50`,
    ).bind(id, id, uid),
  ]);
  const albumList = (albums.results as AlbumRow[]).map(toAlbum);
  return c.json({
    artist: {
      id: artist.id,
      name: artist.name,
      artworkId: artist.artwork_id ?? albumList.find((a) => a.artworkId)?.artworkId ?? null,
      logoId: artist.logo_artwork_id,
    },
    albums: albumList,
    tracks: (top.results as TrackRow[]).map(toTrack),
  });
});

catalog.get('/artists/:id/tracks', anonymousEdgeCache, async (c) => {
  const uid = viewerId(c);
  const id = Number(c.req.param('id'));
  const db = c.env.DB;
  const artist = await findArtist(db, id);
  const { results } = await db.prepare(
    `WITH ${ARTIST_TRACK_IDS}
     SELECT ${TRACK_SELECT}
     FROM artist_track_ids ati JOIN tracks t ON t.id = ati.id ${TRACK_JOINS}
     ORDER BY COALESCE(t.display_title, t.title) COLLATE NOCASE, t.id`,
  ).bind(id, id, uid).all<TrackRow>();
  const tracks = results.map(toTrack);
  return c.json({
    artist: {
      id: artist.id,
      name: artist.name,
      artworkId: artist.artwork_id ?? tracks.find((t) => t.artworkId)?.artworkId ?? null,
    },
    tracks,
  });
});

catalog.get('/search', anonymousEdgeCache, async (c) => {
  const uid = viewerId(c);
  const patterns = searchPatterns(c.req.query('q'));
  if (!patterns) return c.json({ tracks: [], albums: [], artists: [] });
  const { contains, prefix } = patterns;
  const db = c.env.DB;
  const [tracks, albums, artists] = await db.batch([
    db.prepare(
      `SELECT ${TRACK_SELECT} FROM tracks t ${TRACK_JOINS}
       WHERE t.status = 'ready' AND t.visible = 1 AND (
         t.search_key LIKE ?2 ESCAPE '\\' OR t.search_key LIKE ?3 ESCAPE '\\'
         OR al.search_key LIKE ?2 ESCAPE '\\' OR al.search_key LIKE ?3 ESCAPE '\\'
       )
       ORDER BY CASE WHEN t.search_key LIKE ?4 ESCAPE '\\' OR t.search_key LIKE ?5 ESCAPE '\\' THEN 0 ELSE 1 END,
         COALESCE(t.display_title, t.title) COLLATE NOCASE LIMIT 50`,
    ).bind(uid, ...contains, ...prefix),
    db.prepare(
      `SELECT ${ALBUM_SELECT} ${ALBUM_FROM}
       WHERE al.search_key LIKE ?1 ESCAPE '\\' OR al.search_key LIKE ?2 ESCAPE '\\'
         OR EXISTS (SELECT 1 FROM album_artists ala JOIN artists sar ON sar.id = ala.artist_id
                    WHERE ala.album_id = al.id AND (sar.search_key LIKE ?1 ESCAPE '\\' OR sar.search_key LIKE ?2 ESCAPE '\\'))
       GROUP BY al.id LIMIT 20`,
    ).bind(...contains),
    db.prepare(
      `SELECT ar.id, COALESCE(ar.display_name, ar.name) AS name,
         COALESCE(ar.artwork_id, ${ALBUM_ARTWORK_OF_ARTIST}) AS artwork_id
       FROM artists ar WHERE (ar.search_key LIKE ?1 ESCAPE '\\' OR ar.search_key LIKE ?2 ESCAPE '\\')
         AND EXISTS (SELECT 1 FROM track_artists ta JOIN tracks t ON t.id = ta.track_id
                     WHERE ta.artist_id = ar.id AND t.status = 'ready' AND t.visible = 1)
       LIMIT 12`,
    ).bind(...contains),
  ]);
  return c.json({
    tracks: (tracks.results as TrackRow[]).map(toTrack),
    albums: (albums.results as AlbumRow[]).map(toAlbum),
    artists: (artists.results as { id: number; name: string; artwork_id: string | null }[]).map((a) => ({
      id: a.id,
      name: a.name,
      artworkId: a.artwork_id,
    })),
  });
});

library.get('/admin/tracks', requireAdmin, async (c) => {
  const uid = c.get('user').id;
  const patterns = searchPatterns(c.req.query('q'));
  const visibility = c.req.query('visibility') ?? 'all';
  const limit = int(c.req.query('limit'), 100, 200);
  const offset = int(c.req.query('offset'), 0, 1e9);
  const conditions = ["t.status = 'ready'"];
  const trackBindings: (string | number)[] = [uid];

  if (visibility === 'visible') conditions.push('t.visible = 1');
  else if (visibility === 'hidden') conditions.push('t.visible = 0');
  else if (visibility !== 'all') throw new HTTPException(400, { message: '無效的顯示篩選條件' });

  if (patterns) {
    const [key, reading] = patterns.contains;
    conditions.push(
      "(t.search_key LIKE ? ESCAPE '\\' OR t.search_key LIKE ? ESCAPE '\\' OR al.search_key LIKE ? ESCAPE '\\' OR al.search_key LIKE ? ESCAPE '\\')",
    );
    trackBindings.push(key, reading, key, reading);
  }

  const where = conditions.join(' AND ');
  const tracksStatement = c.env.DB.prepare(
    `SELECT ${TRACK_SELECT}, t.visible FROM tracks t ${TRACK_JOINS}
     WHERE ${where} ORDER BY COALESCE(t.display_title, t.title) COLLATE NOCASE, t.id LIMIT ? OFFSET ?`,
  ).bind(...trackBindings, limit + 1, offset);
  const statsStatement = c.env.DB.prepare(
    `SELECT COUNT(*) AS total,
       COALESCE(SUM(CASE WHEN visible = 1 THEN 1 ELSE 0 END), 0) AS visible,
       COALESCE(SUM(CASE WHEN visible = 0 THEN 1 ELSE 0 END), 0) AS hidden
     FROM tracks WHERE status = 'ready'`,
  );
  const [tracks, stats] = await c.env.DB.batch(offset === 0 ? [tracksStatement, statsStatement] : [tracksStatement]);
  const rows = tracks.results as (TrackRow & { visible: number })[];

  return c.json({
    tracks: rows.slice(0, limit).map((row) => ({ ...toTrack(row), visible: !!row.visible })),
    hasMore: rows.length > limit,
    stats: stats ? (stats.results[0] as { total: number; visible: number; hidden: number } | undefined) ?? null : null,
  });
});

library.patch('/admin/tracks/:id/visibility', requireAdmin, async (c) => {
  const id = Number(c.req.param('id'));
  const body = await c.req.json<{ visible?: boolean }>();
  if (!Number.isInteger(id) || id <= 0 || typeof body.visible !== 'boolean') {
    throw new HTTPException(400, { message: '請提供有效的歌曲與顯示狀態' });
  }
  const row = await c.env.DB.prepare(
    "UPDATE tracks SET visible = ?, updated_at = ? WHERE id = ? AND status = 'ready' RETURNING id, visible",
  ).bind(body.visible ? 1 : 0, Date.now(), id).first<{ id: number; visible: number }>();
  if (!row) throw new HTTPException(404, { message: '找不到這首歌' });
  return c.json({ id: row.id, visible: !!row.visible });
});

library.get('/tracks/:id/lyrics', async (c) => {
  const row = await c.env.DB.prepare(
    'SELECT l.content, l.synced, l.source, l.format FROM lyrics l JOIN tracks t ON t.id = l.track_id WHERE l.track_id = ? AND t.visible = 1',
  )
    .bind(Number(c.req.param('id')))
    .first<{ content: string; synced: number; source: string; format: 'lrc' | 'ttml' | 'plain' }>();
  if (!row) return c.json({ lyrics: null });
  return c.json({ lyrics: { content: row.content, synced: !!row.synced, source: row.source, format: row.format } });
});

export default library;
