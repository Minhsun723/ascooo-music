import { Hono } from 'hono';
import { HTTPException } from 'hono/http-exception';
import type { AppEnv } from '../env';
import { TRACK_JOINS, TRACK_SELECT, type TrackRow, toTrack } from '../lib/sql';

const me = new Hono<AppEnv>();

// ---------- favorites ----------

me.get('/favorites', async (c) => {
  const uid = c.get('user').id;
  const { results } = await c.env.DB.prepare(
    `SELECT ${TRACK_SELECT} FROM favorites fv JOIN tracks t ON t.id = fv.track_id ${TRACK_JOINS}
     WHERE fv.user_id = ? AND t.status = 'ready' AND t.visible = 1 ORDER BY fv.created_at DESC`,
  )
    .bind(uid, uid)
    .all<TrackRow>();
  return c.json({ tracks: results.map(toTrack) });
});

me.put('/favorites/:trackId', async (c) => {
  await c.env.DB.prepare(
    "INSERT OR IGNORE INTO favorites (user_id, track_id, created_at) SELECT ?, id, ? FROM tracks WHERE id = ? AND status = 'ready' AND visible = 1",
  )
    .bind(c.get('user').id, Date.now(), Number(c.req.param('trackId')))
    .run();
  return c.json({ liked: true });
});

me.delete('/favorites/:trackId', async (c) => {
  await c.env.DB.prepare('DELETE FROM favorites WHERE user_id = ? AND track_id = ?')
    .bind(c.get('user').id, Number(c.req.param('trackId')))
    .run();
  return c.json({ liked: false });
});

// ---------- history ----------

me.post('/history', async (c) => {
  const { trackId } = await c.req.json<{ trackId: number }>();
  await c.env.DB.prepare(
    "INSERT INTO play_history (user_id, track_id, played_at) SELECT ?, id, ? FROM tracks WHERE id = ? AND status = 'ready' AND visible = 1",
  )
    .bind(c.get('user').id, Date.now(), Number(trackId))
    .run();
  return c.json({ ok: true });
});

// ---------- playlists ----------

async function ownPlaylist(c: { env: AppEnv['Bindings'] }, id: number, uid: number) {
  const p = await c.env.DB.prepare('SELECT * FROM playlists WHERE id = ? AND user_id = ?').bind(id, uid).first<{
    id: number;
    name: string;
    description: string | null;
    created_at: number;
    updated_at: number;
  }>();
  if (!p) throw new HTTPException(404, { message: '找不到這個播放清單' });
  return p;
}

me.get('/playlists', async (c) => {
  const { results } = await c.env.DB.prepare(
    `SELECT p.id, p.name, p.description, p.updated_at, COUNT(t.id) AS track_count,
       COALESCE(SUM(t.duration), 0) AS duration,
       (SELECT COALESCE(t2.artwork_id, al2.artwork_id) FROM playlist_tracks pt2
          JOIN tracks t2 ON t2.id = pt2.track_id LEFT JOIN albums al2 ON al2.id = t2.album_id
          WHERE pt2.playlist_id = p.id AND t2.status = 'ready' AND t2.visible = 1 ORDER BY pt2.position LIMIT 4) AS artwork_id
     FROM playlists p
     LEFT JOIN playlist_tracks pt ON pt.playlist_id = p.id
     LEFT JOIN tracks t ON t.id = pt.track_id AND t.status = 'ready' AND t.visible = 1
     WHERE p.user_id = ? GROUP BY p.id ORDER BY p.updated_at DESC`,
  )
    .bind(c.get('user').id)
    .all<{ id: number; name: string; description: string | null; updated_at: number; track_count: number; duration: number; artwork_id: string | null }>();
  return c.json({
    playlists: results.map((p) => ({
      id: p.id,
      name: p.name,
      description: p.description,
      updatedAt: p.updated_at,
      trackCount: p.track_count,
      duration: p.duration,
      artworkId: p.artwork_id,
    })),
  });
});

me.post('/playlists', async (c) => {
  const body = await c.req.json<{ name?: string; description?: string; trackIds?: number[] }>();
  const name = String(body.name ?? '').trim().slice(0, 100) || '新的播放清單';
  const now = Date.now();
  const row = await c.env.DB.prepare(
    'INSERT INTO playlists (user_id, name, description, created_at, updated_at) VALUES (?, ?, ?, ?, ?) RETURNING id',
  )
    .bind(c.get('user').id, name, body.description?.trim() || null, now, now)
    .first<{ id: number }>();
  if (body.trackIds?.length) await appendTracks(c.env.DB, row!.id, body.trackIds);
  return c.json({ id: row!.id, name });
});

async function appendTracks(db: D1Database, playlistId: number, trackIds: number[]) {
  const max = await db.prepare('SELECT COALESCE(MAX(position), 0) AS m FROM playlist_tracks WHERE playlist_id = ?')
    .bind(playlistId)
    .first<{ m: number }>();
  let pos = max?.m ?? 0;
  const now = Date.now();
  const stmt = db.prepare(
    "INSERT INTO playlist_tracks (playlist_id, track_id, position, added_at) SELECT ?, id, ?, ? FROM tracks WHERE id = ? AND status = 'ready' AND visible = 1",
  );
  await db.batch([
    ...trackIds.slice(0, 500).map((id) => stmt.bind(playlistId, ++pos, now, Number(id))),
    db.prepare('UPDATE playlists SET updated_at = ? WHERE id = ?').bind(now, playlistId),
  ]);
}

me.get('/playlists/:id', async (c) => {
  const uid = c.get('user').id;
  const p = await ownPlaylist(c, Number(c.req.param('id')), uid);
  const { results } = await c.env.DB.prepare(
    `SELECT ${TRACK_SELECT}, pt.id AS entry_id FROM playlist_tracks pt JOIN tracks t ON t.id = pt.track_id ${TRACK_JOINS}
     WHERE pt.playlist_id = ? AND t.status = 'ready' AND t.visible = 1 ORDER BY pt.position`,
  )
    .bind(uid, p.id)
    .all<TrackRow & { entry_id: number }>();
  return c.json({
    playlist: { id: p.id, name: p.name, description: p.description, updatedAt: p.updated_at },
    tracks: results.map((r) => ({ ...toTrack(r), entryId: r.entry_id })),
  });
});

me.patch('/playlists/:id', async (c) => {
  const p = await ownPlaylist(c, Number(c.req.param('id')), c.get('user').id);
  const body = await c.req.json<{ name?: string; description?: string }>();
  await c.env.DB.prepare('UPDATE playlists SET name = ?, description = ?, updated_at = ? WHERE id = ?')
    .bind(body.name?.trim() || p.name, body.description ?? p.description, Date.now(), p.id)
    .run();
  return c.json({ ok: true });
});

me.delete('/playlists/:id', async (c) => {
  const p = await ownPlaylist(c, Number(c.req.param('id')), c.get('user').id);
  await c.env.DB.batch([
    c.env.DB.prepare('DELETE FROM playlist_tracks WHERE playlist_id = ?').bind(p.id),
    c.env.DB.prepare('DELETE FROM playlists WHERE id = ?').bind(p.id),
  ]);
  return c.json({ ok: true });
});

me.post('/playlists/:id/tracks', async (c) => {
  const p = await ownPlaylist(c, Number(c.req.param('id')), c.get('user').id);
  const { trackIds } = await c.req.json<{ trackIds: number[] }>();
  if (!Array.isArray(trackIds) || !trackIds.length) throw new HTTPException(400, { message: '沒有要加入的歌曲' });
  await appendTracks(c.env.DB, p.id, trackIds);
  return c.json({ ok: true, added: trackIds.length });
});

me.delete('/playlists/:id/tracks/:entryId', async (c) => {
  const p = await ownPlaylist(c, Number(c.req.param('id')), c.get('user').id);
  await c.env.DB.batch([
    c.env.DB.prepare('DELETE FROM playlist_tracks WHERE id = ? AND playlist_id = ?').bind(Number(c.req.param('entryId')), p.id),
    c.env.DB.prepare('UPDATE playlists SET updated_at = ? WHERE id = ?').bind(Date.now(), p.id),
  ]);
  return c.json({ ok: true });
});

/** Reorder: move an entry between two neighbours using fractional positions. */
me.post('/playlists/:id/move', async (c) => {
  const p = await ownPlaylist(c, Number(c.req.param('id')), c.get('user').id);
  const { entryId, toIndex } = await c.req.json<{ entryId: number; toIndex: number }>();
  const { results } = await c.env.DB.prepare('SELECT id, position FROM playlist_tracks WHERE playlist_id = ? ORDER BY position')
    .bind(p.id)
    .all<{ id: number; position: number }>();
  const list = results.filter((r) => r.id !== entryId);
  const before = list[toIndex - 1]?.position ?? 0;
  const after = list[toIndex]?.position ?? before + 2;
  await c.env.DB.prepare('UPDATE playlist_tracks SET position = ? WHERE id = ? AND playlist_id = ?')
    .bind((before + after) / 2, entryId, p.id)
    .run();
  return c.json({ ok: true });
});

export default me;
