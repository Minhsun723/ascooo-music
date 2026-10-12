import { Hono } from 'hono';
import { HTTPException } from 'hono/http-exception';
import type { AppEnv } from '../env';
import {
  ALBUM_FROM,
  ALBUM_SELECT,
  type AlbumRow,
  TRACK_JOINS,
  TRACK_SELECT,
  type TrackRow,
  likePattern,
  toAlbum,
  toTrack,
} from '../lib/sql';

const library = new Hono<AppEnv>();

const int = (v: string | undefined, def: number, max = 500) => {
  const n = parseInt(v ?? '', 10);
  return Number.isFinite(n) && n >= 0 ? Math.min(n, max) : def;
};

const TRACK_SORTS: Record<string, string> = {
  added: 't.added_at DESC, t.id DESC',
  title: 't.title COLLATE NOCASE ASC',
  artist: 't.artist COLLATE NOCASE ASC, al.title COLLATE NOCASE, t.disc_no, t.track_no',
  album: 'al.title COLLATE NOCASE ASC, t.disc_no, t.track_no',
  duration: 't.duration DESC',
};

const ALBUM_SORTS: Record<string, string> = {
  added: 'added_at DESC',
  title: 'al.title COLLATE NOCASE ASC',
  artist: 'ar.name COLLATE NOCASE ASC, al.year',
  year: 'al.year DESC',
};

library.get('/home', async (c) => {
  const uid = c.get('user').id;
  const db = c.env.DB;
  const [recentAlbums, recentPlays, randomAlbums, randomTracks, stats] = await db.batch([
    db.prepare(`SELECT ${ALBUM_SELECT} ${ALBUM_FROM} GROUP BY al.id ORDER BY added_at DESC LIMIT 12`),
    db.prepare(
      `SELECT ${TRACK_SELECT} FROM (
         SELECT track_id, MAX(played_at) AS last FROM play_history WHERE user_id = ? GROUP BY track_id
         ORDER BY last DESC LIMIT 16
       ) h JOIN tracks t ON t.id = h.track_id ${TRACK_JOINS} WHERE t.status = 'ready' ORDER BY h.last DESC`,
    ).bind(uid, uid),
    db.prepare(`SELECT ${ALBUM_SELECT} ${ALBUM_FROM} GROUP BY al.id ORDER BY RANDOM() LIMIT 12`),
    db.prepare(`SELECT ${TRACK_SELECT} FROM tracks t ${TRACK_JOINS} WHERE t.status = 'ready' ORDER BY RANDOM() LIMIT 20`).bind(uid),
    db.prepare(
      `SELECT COUNT(*) AS tracks, COALESCE(SUM(size),0) AS bytes, COALESCE(SUM(duration),0) AS seconds,
        COALESCE(SUM(CASE WHEN codec IN ('flac','alac','wav') THEN 1 ELSE 0 END), 0) AS lossless,
        (SELECT COUNT(*) FROM albums) AS albums, (SELECT COUNT(*) FROM artists) AS artists,
        COALESCE(SUM(has_lyrics), 0) AS with_lyrics
       FROM tracks WHERE status = 'ready'`,
    ),
  ]);
  return c.json({
    recentAlbums: (recentAlbums.results as AlbumRow[]).map(toAlbum),
    recentPlays: (recentPlays.results as TrackRow[]).map(toTrack),
    randomAlbums: (randomAlbums.results as AlbumRow[]).map(toAlbum),
    quickPicks: (randomTracks.results as TrackRow[]).map(toTrack),
    stats: stats.results[0],
  });
});

library.get('/tracks', async (c) => {
  const uid = c.get('user').id;
  const sort = TRACK_SORTS[c.req.query('sort') ?? 'added'] ?? TRACK_SORTS.added;
  const limit = int(c.req.query('limit'), 100);
  const offset = int(c.req.query('offset'), 0, 1e9);
  const { results } = await c.env.DB.prepare(
    `SELECT ${TRACK_SELECT} FROM tracks t ${TRACK_JOINS} WHERE t.status = 'ready' ORDER BY ${sort} LIMIT ? OFFSET ?`,
  )
    .bind(uid, limit, offset)
    .all<TrackRow>();
  const total = await c.env.DB.prepare("SELECT COUNT(*) AS n FROM tracks WHERE status = 'ready'").first<{ n: number }>();
  return c.json({ tracks: results.map(toTrack), total: total?.n ?? 0 });
});

library.get('/albums', async (c) => {
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

library.get('/albums/:id', async (c) => {
  const uid = c.get('user').id;
  const id = Number(c.req.param('id'));
  const db = c.env.DB;
  const album = await db.prepare(`SELECT ${ALBUM_SELECT} ${ALBUM_FROM} WHERE al.id = ? GROUP BY al.id`).bind(id).first<AlbumRow>();
  if (!album) throw new HTTPException(404, { message: '找不到這張專輯' });
  const [tracks, more] = await db.batch([
    db.prepare(
      `SELECT ${TRACK_SELECT} FROM tracks t ${TRACK_JOINS} WHERE t.album_id = ? AND t.status = 'ready'
       ORDER BY COALESCE(t.disc_no, 1), COALESCE(t.track_no, 9999), t.title`,
    ).bind(uid, id),
    db.prepare(`SELECT ${ALBUM_SELECT} ${ALBUM_FROM} WHERE al.artist_id = ? AND al.id != ? GROUP BY al.id ORDER BY al.year DESC LIMIT 12`).bind(
      album.artist_id,
      id,
    ),
  ]);
  return c.json({
    album: toAlbum(album),
    tracks: (tracks.results as TrackRow[]).map(toTrack),
    moreByArtist: (more.results as AlbumRow[]).map(toAlbum),
  });
});

library.get('/artists', async (c) => {
  const limit = int(c.req.query('limit'), 200);
  const offset = int(c.req.query('offset'), 0, 1e9);
  const { results } = await c.env.DB.prepare(
    `SELECT ar.id, ar.name, COUNT(t.id) AS track_count,
       (SELECT al.artwork_id FROM albums al WHERE al.artist_id = ar.id AND al.artwork_id IS NOT NULL LIMIT 1) AS artwork_id
     FROM artists ar
     JOIN tracks t ON (t.artist_id = ar.id OR t.album_id IN (SELECT id FROM albums WHERE artist_id = ar.id)) AND t.status = 'ready'
     GROUP BY ar.id ORDER BY ar.name COLLATE NOCASE LIMIT ? OFFSET ?`,
  )
    .bind(limit, offset)
    .all<{ id: number; name: string; track_count: number; artwork_id: string | null }>();
  return c.json({
    artists: results.map((r) => ({ id: r.id, name: r.name, trackCount: r.track_count, artworkId: r.artwork_id })),
  });
});

library.get('/artists/:id', async (c) => {
  const uid = c.get('user').id;
  const id = Number(c.req.param('id'));
  const db = c.env.DB;
  const artist = await db.prepare('SELECT id, name FROM artists WHERE id = ?').bind(id).first<{ id: number; name: string }>();
  if (!artist) throw new HTTPException(404, { message: '找不到這位歌手' });
  const [albums, top] = await db.batch([
    db.prepare(`SELECT ${ALBUM_SELECT} ${ALBUM_FROM} WHERE al.artist_id = ? GROUP BY al.id ORDER BY al.year DESC, al.title`).bind(id),
    db.prepare(
      `SELECT ${TRACK_SELECT}, (SELECT COUNT(*) FROM play_history ph WHERE ph.track_id = t.id) AS plays
       FROM tracks t ${TRACK_JOINS}
       WHERE (t.artist_id = ? OR al.artist_id = ?) AND t.status = 'ready'
       ORDER BY plays DESC, t.added_at DESC LIMIT 50`,
    ).bind(uid, id, id),
  ]);
  const albumList = (albums.results as AlbumRow[]).map(toAlbum);
  return c.json({
    artist: { ...artist, artworkId: albumList.find((a) => a.artworkId)?.artworkId ?? null },
    albums: albumList,
    tracks: (top.results as TrackRow[]).map(toTrack),
  });
});

library.get('/search', async (c) => {
  const uid = c.get('user').id;
  const q = (c.req.query('q') ?? '').trim();
  if (!q) return c.json({ tracks: [], albums: [], artists: [] });
  const like = likePattern(q);
  const db = c.env.DB;
  const [tracks, albums, artists] = await db.batch([
    db.prepare(
      `SELECT ${TRACK_SELECT} FROM tracks t ${TRACK_JOINS}
       WHERE t.status = 'ready' AND (t.title LIKE ?2 ESCAPE '\\' OR t.artist LIKE ?2 ESCAPE '\\' OR al.title LIKE ?2 ESCAPE '\\')
       ORDER BY CASE WHEN t.title LIKE ?3 ESCAPE '\\' THEN 0 ELSE 1 END, t.title COLLATE NOCASE LIMIT 50`,
    ).bind(uid, like, likePattern(q).slice(1)),
    db.prepare(
      `SELECT ${ALBUM_SELECT} ${ALBUM_FROM} WHERE al.title LIKE ? ESCAPE '\\' OR ar.name LIKE ? ESCAPE '\\' GROUP BY al.id LIMIT 20`,
    ).bind(like, like),
    db.prepare(
      `SELECT ar.id, ar.name,
         (SELECT al.artwork_id FROM albums al WHERE al.artist_id = ar.id AND al.artwork_id IS NOT NULL LIMIT 1) AS artwork_id
       FROM artists ar WHERE ar.name LIKE ? ESCAPE '\\'
         AND EXISTS (SELECT 1 FROM tracks t WHERE t.artist_id = ar.id AND t.status = 'ready')
       LIMIT 12`,
    ).bind(like),
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

library.get('/tracks/:id/lyrics', async (c) => {
  const row = await c.env.DB.prepare('SELECT content, synced, source FROM lyrics WHERE track_id = ?')
    .bind(Number(c.req.param('id')))
    .first<{ content: string; synced: number; source: string }>();
  if (!row) return c.json({ lyrics: null });
  return c.json({ lyrics: { content: row.content, synced: !!row.synced, source: row.source } });
});

export default library;
