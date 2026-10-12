import { Hono } from 'hono';
import { HTTPException } from 'hono/http-exception';
import type { AppEnv } from '../env';
import { requireAdmin } from '../lib/auth';
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
       ) h JOIN tracks t ON t.id = h.track_id ${TRACK_JOINS} WHERE t.status = 'ready' AND t.visible = 1 ORDER BY h.last DESC`,
    ).bind(uid, uid),
    db.prepare(`SELECT ${ALBUM_SELECT} ${ALBUM_FROM} GROUP BY al.id ORDER BY RANDOM() LIMIT 12`),
    db.prepare(`SELECT ${TRACK_SELECT} FROM tracks t ${TRACK_JOINS} WHERE t.status = 'ready' AND t.visible = 1 ORDER BY RANDOM() LIMIT 20`).bind(uid),
    db.prepare(
      `SELECT COUNT(*) AS tracks, COALESCE(SUM(size),0) AS bytes, COALESCE(SUM(duration),0) AS seconds,
        COALESCE(SUM(CASE WHEN codec IN ('flac','alac','wav') THEN 1 ELSE 0 END), 0) AS lossless,
        (SELECT COUNT(*) FROM albums al WHERE EXISTS (
          SELECT 1 FROM tracks at WHERE at.album_id = al.id AND at.status = 'ready' AND at.visible = 1
        )) AS albums,
        (SELECT COUNT(*) FROM artists ar WHERE EXISTS (
          SELECT 1 FROM tracks art LEFT JOIN albums aal ON aal.id = art.album_id
          WHERE (art.artist_id = ar.id OR aal.artist_id = ar.id) AND art.status = 'ready' AND art.visible = 1
        )) AS artists,
        COALESCE(SUM(has_lyrics), 0) AS with_lyrics
       FROM tracks WHERE status = 'ready' AND visible = 1`,
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
    `SELECT ${TRACK_SELECT} FROM tracks t ${TRACK_JOINS} WHERE t.status = 'ready' AND t.visible = 1 ORDER BY ${sort} LIMIT ? OFFSET ?`,
  )
    .bind(uid, limit, offset)
    .all<TrackRow>();
  const total = await c.env.DB.prepare("SELECT COUNT(*) AS n FROM tracks WHERE status = 'ready' AND visible = 1").first<{ n: number }>();
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
      `SELECT ${TRACK_SELECT} FROM tracks t ${TRACK_JOINS} WHERE t.album_id = ? AND t.status = 'ready' AND t.visible = 1
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
     JOIN tracks t ON (t.artist_id = ar.id OR t.album_id IN (SELECT id FROM albums WHERE artist_id = ar.id)) AND t.status = 'ready' AND t.visible = 1
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
  const artist = await db.prepare(
    `SELECT ar.id, ar.name FROM artists ar WHERE ar.id = ? AND EXISTS (
       SELECT 1 FROM tracks t LEFT JOIN albums al ON al.id = t.album_id
       WHERE (t.artist_id = ar.id OR al.artist_id = ar.id) AND t.status = 'ready' AND t.visible = 1
     )`,
  ).bind(id).first<{ id: number; name: string }>();
  if (!artist) throw new HTTPException(404, { message: '找不到這位歌手' });
  const [albums, top] = await db.batch([
    db.prepare(`SELECT ${ALBUM_SELECT} ${ALBUM_FROM} WHERE al.artist_id = ? GROUP BY al.id ORDER BY al.year DESC, al.title`).bind(id),
    db.prepare(
      `SELECT ${TRACK_SELECT}, (SELECT COUNT(*) FROM play_history ph WHERE ph.track_id = t.id) AS plays
       FROM tracks t ${TRACK_JOINS}
       WHERE (t.artist_id = ? OR al.artist_id = ?) AND t.status = 'ready' AND t.visible = 1
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
       WHERE t.status = 'ready' AND t.visible = 1 AND (t.title LIKE ?2 ESCAPE '\\' OR t.artist LIKE ?2 ESCAPE '\\' OR al.title LIKE ?2 ESCAPE '\\')
       ORDER BY CASE WHEN t.title LIKE ?3 ESCAPE '\\' THEN 0 ELSE 1 END, t.title COLLATE NOCASE LIMIT 50`,
    ).bind(uid, like, likePattern(q).slice(1)),
    db.prepare(
      `SELECT ${ALBUM_SELECT} ${ALBUM_FROM} WHERE al.title LIKE ? ESCAPE '\\' OR ar.name LIKE ? ESCAPE '\\' GROUP BY al.id LIMIT 20`,
    ).bind(like, like),
    db.prepare(
      `SELECT ar.id, ar.name,
         (SELECT al.artwork_id FROM albums al WHERE al.artist_id = ar.id AND al.artwork_id IS NOT NULL LIMIT 1) AS artwork_id
       FROM artists ar WHERE ar.name LIKE ? ESCAPE '\\'
         AND EXISTS (SELECT 1 FROM tracks t WHERE t.artist_id = ar.id AND t.status = 'ready' AND t.visible = 1)
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

library.get('/admin/tracks', requireAdmin, async (c) => {
  const uid = c.get('user').id;
  const q = (c.req.query('q') ?? '').trim();
  const visibility = c.req.query('visibility') ?? 'all';
  const limit = int(c.req.query('limit'), 100, 200);
  const offset = int(c.req.query('offset'), 0, 1e9);
  const conditions = ["t.status = 'ready'"];
  const trackBindings: (string | number)[] = [uid];
  const countBindings: string[] = [];

  if (visibility === 'visible') conditions.push('t.visible = 1');
  else if (visibility === 'hidden') conditions.push('t.visible = 0');
  else if (visibility !== 'all') throw new HTTPException(400, { message: '無效的顯示篩選條件' });

  if (q) {
    const like = likePattern(q);
    conditions.push("(t.title LIKE ? ESCAPE '\\' OR t.artist LIKE ? ESCAPE '\\' OR al.title LIKE ? ESCAPE '\\')");
    trackBindings.push(like, like, like);
    countBindings.push(like, like, like);
  }

  const where = conditions.join(' AND ');
  const tracksStatement = c.env.DB.prepare(
    `SELECT ${TRACK_SELECT}, t.visible FROM tracks t ${TRACK_JOINS}
     WHERE ${where} ORDER BY t.title COLLATE NOCASE, t.id LIMIT ? OFFSET ?`,
  ).bind(...trackBindings, limit, offset);
  const countStatement = c.env.DB.prepare(
    `SELECT COUNT(*) AS n FROM tracks t LEFT JOIN albums al ON al.id = t.album_id WHERE ${where}`,
  ).bind(...countBindings);
  const statsStatement = c.env.DB.prepare(
    `SELECT COUNT(*) AS total,
       COALESCE(SUM(CASE WHEN visible = 1 THEN 1 ELSE 0 END), 0) AS visible,
       COALESCE(SUM(CASE WHEN visible = 0 THEN 1 ELSE 0 END), 0) AS hidden
     FROM tracks WHERE status = 'ready'`,
  );
  const [tracks, count, stats] = await c.env.DB.batch([tracksStatement, countStatement, statsStatement]);

  return c.json({
    tracks: (tracks.results as (TrackRow & { visible: number })[]).map((row) => ({ ...toTrack(row), visible: !!row.visible })),
    total: (count.results[0] as { n: number } | undefined)?.n ?? 0,
    stats: (stats.results[0] as { total: number; visible: number; hidden: number } | undefined) ?? { total: 0, visible: 0, hidden: 0 },
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
    'SELECT l.content, l.synced, l.source FROM lyrics l JOIN tracks t ON t.id = l.track_id WHERE l.track_id = ? AND t.visible = 1',
  )
    .bind(Number(c.req.param('id')))
    .first<{ content: string; synced: number; source: string }>();
  if (!row) return c.json({ lyrics: null });
  return c.json({ lyrics: { content: row.content, synced: !!row.synced, source: row.source } });
});

export default library;
