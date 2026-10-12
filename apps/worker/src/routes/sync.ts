import { Hono } from 'hono';
import { HTTPException } from 'hono/http-exception';
import type { AppEnv, Env } from '../env';
import { requireAdmin } from '../lib/auth';
import { AUDIO_EXTENSIONS, type AudioMetadata, extOf, extractMetadata, guessFromFilename } from '../lib/metadata';
import { type DavEntry, WebDAV, normalizePath, parentDir } from '../lib/webdav';

/**
 * Sync is driven by the browser in small steps so each Worker invocation stays
 * well within subrequest/CPU limits:
 *   1. POST /list      — PROPFIND one folder, upsert audio files as `pending`
 *   2. POST /process   — extract tags for a few pending files, write to D1
 *   3. POST /finalize  — drop rows for files that no longer exist on PikPak
 */
const sync = new Hono<AppEnv>();
sync.use('*', requireAdmin);

const MAX_ART_BYTES = 1_900_000; // D1 BLOB limit is 2 MB
const COVER_NAMES = ['cover', 'folder', 'front', 'album', 'albumart', 'albumcover', 'artwork', 'jacket', '封面', '專輯封面', '专辑封面'];
const IMAGE_EXT = ['jpg', 'jpeg', 'png', 'webp', 'avif', 'gif'];
const LRC_SYNCED = /^\s*\[\d{1,3}:\d{2}(?:[.:]\d{1,3})?\]/m;

const stem = (p: string) => p.slice(p.lastIndexOf('/') + 1).replace(/\.[^.]+$/, '').toLowerCase();

function normalizedCoverName(name: string): string {
  return stem(name).normalize('NFKC').replace(/[\s._()[\]{}-]+/g, '');
}

function coverRank(name: string): number | null {
  const value = normalizedCoverName(name);
  const exact = COVER_NAMES.indexOf(value);
  if (exact >= 0) return exact;
  const partial = COVER_NAMES.findIndex((candidate) => value.startsWith(candidate) || value.endsWith(candidate));
  return partial >= 0 ? 50 + partial : null;
}

function folderCover(files: DavEntry[]): { file: DavEntry | null; skippedOversized: string | null } {
  const images = files.filter((file) => IMAGE_EXT.includes(extOf(file.name)));
  const named = images
    .map((file) => ({ file, rank: coverRank(file.name) }))
    .filter((candidate): candidate is { file: DavEntry; rank: number } => candidate.rank !== null)
    .sort((a, b) => a.rank - b.rank || a.file.size - b.file.size);

  // Album folders often contain a single image named after the album. It is a
  // safer fallback than guessing when a folder also contains booklet scans.
  const candidates = named.length ? named.map((candidate) => candidate.file) : images.length === 1 ? images : [];
  const file = candidates.find((candidate) => candidate.size <= MAX_ART_BYTES) ?? null;
  return {
    file,
    skippedOversized: !file && candidates.length ? candidates[0].name : null,
  };
}

function coverSignature(file: DavEntry | null): string | null {
  if (!file) return null;
  return file.etag || `${file.size}:${file.mtime ?? ''}`;
}

function artworkMime(path: string, data: Uint8Array, hint = ''): string {
  if (data[0] === 0xff && data[1] === 0xd8 && data[2] === 0xff) return 'image/jpeg';
  if (data[0] === 0x89 && data[1] === 0x50 && data[2] === 0x4e && data[3] === 0x47) return 'image/png';
  if (data[0] === 0x47 && data[1] === 0x49 && data[2] === 0x46 && data[3] === 0x38) return 'image/gif';
  if (data[0] === 0x52 && data[1] === 0x49 && data[2] === 0x46 && data[3] === 0x46 &&
      data[8] === 0x57 && data[9] === 0x45 && data[10] === 0x42 && data[11] === 0x50) return 'image/webp';
  if (data.length >= 12 && String.fromCharCode(...data.subarray(4, 12)).startsWith('ftypavif')) return 'image/avif';

  const normalizedHint = hint.toLowerCase() === 'image/jpg' ? 'image/jpeg' : hint.toLowerCase();
  if (normalizedHint.startsWith('image/')) return normalizedHint;
  const ext = extOf(path);
  return ext === 'png' ? 'image/png'
    : ext === 'webp' ? 'image/webp'
      : ext === 'avif' ? 'image/avif'
        : ext === 'gif' ? 'image/gif'
          : 'image/jpeg';
}

function assertInRoot(env: Env, dir: string) {
  const root = normalizePath(env.MUSIC_ROOT || '/');
  const d = normalizePath(dir);
  if (root !== '/' && d !== root && !d.startsWith(root + '/')) {
    throw new HTTPException(400, { message: `資料夾必須位於 ${root} 之內` });
  }
  return d;
}

sync.get('/status', async (c) => {
  const db = c.env.DB;
  const [counts, errors] = await db.batch([
    db.prepare(
      `SELECT status, COUNT(*) AS n, SUM(CASE WHEN error IS NOT NULL THEN 1 ELSE 0 END) AS errors FROM tracks GROUP BY status`,
    ),
    db.prepare(`SELECT id, path, error FROM tracks WHERE error IS NOT NULL ORDER BY updated_at DESC LIMIT 50`),
  ]);
  const by: Record<string, number> = {};
  let errorCount = 0;
  for (const r of counts.results as { status: string; n: number; errors: number }[]) {
    by[r.status] = r.n;
    errorCount += r.errors;
  }
  return c.json({
    root: normalizePath(c.env.MUSIC_ROOT || '/'),
    ready: by.ready ?? 0,
    pending: by.pending ?? 0,
    errorCount,
    errors: errors.results,
  });
});

sync.post('/list', async (c) => {
  const body = await c.req.json<{ dir?: string; scanId: string }>();
  if (!body.scanId) throw new HTTPException(400, { message: '缺少 scanId' });
  const dir = assertInRoot(c.env, body.dir || c.env.MUSIC_ROOT || '/');
  const dav = new WebDAV(c.env);
  const entries = await dav.list(dir);

  const dirs = entries.filter((e) => e.isDir).map((e) => e.path);
  const files = entries.filter((e) => !e.isDir);
  const audio = files.filter((f) => AUDIO_EXTENSIONS.includes(extOf(f.name)));
  const lrcByStem = new Map(files.filter((f) => extOf(f.name) === 'lrc').map((f) => [stem(f.name), f.path]));
  const selectedCover = folderCover(files);
  const cover = selectedCover.file;
  const signature = coverSignature(cover);

  const now = Date.now();
  const stmt = c.env.DB.prepare(
    `INSERT INTO tracks (path, lrc_path, cover_path, cover_signature, size, etag, mtime, scan_id, status, title, added_at, updated_at)
     VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, 'pending', ?9, ?10, ?10)
     ON CONFLICT(path) DO UPDATE SET
       status = CASE
         WHEN tracks.size != excluded.size
           OR COALESCE(tracks.etag, '') != COALESCE(excluded.etag, '')
           OR COALESCE(tracks.lrc_path, '') != COALESCE(excluded.lrc_path, '')
           OR COALESCE(tracks.cover_path, '') != COALESCE(excluded.cover_path, '')
           OR COALESCE(tracks.cover_signature, '') != COALESCE(excluded.cover_signature, '')
          OR tracks.metadata_version < 1
         THEN 'pending' ELSE tracks.status END,
       lrc_path = excluded.lrc_path,
       cover_path = excluded.cover_path,
       cover_signature = excluded.cover_signature,
       size = excluded.size,
       etag = excluded.etag,
       mtime = excluded.mtime,
       scan_id = excluded.scan_id`,
  );
  if (audio.length) {
    await c.env.DB.batch(
      audio.map((f) =>
        stmt.bind(
          f.path,
          lrcByStem.get(stem(f.name)) ?? null,
          cover?.path ?? null,
          signature,
          f.size,
          f.etag,
          f.mtime,
          body.scanId,
          guessFromFilename(f.path).title,
          now,
        ),
      ),
    );
  }
  return c.json({ dir, dirs, audioFiles: audio.length, skippedOversizedCover: selectedCover.skippedOversized });
});

sync.post('/process', async (c) => {
  const body = await c.req.json<{ limit?: number }>().catch(() => ({}) as { limit?: number });
  const limit = Math.min(Math.max(Number(body.limit) || 4, 1), 10);
  const db = c.env.DB;
  const { results } = await db
    .prepare(`SELECT id, path, size, lrc_path, cover_path FROM tracks WHERE status = 'pending' ORDER BY id LIMIT ?`)
    .bind(limit)
    .all<{ id: number; path: string; size: number; lrc_path: string | null; cover_path: string | null }>();

  const dav = new WebDAV(c.env);
  const processed: { id: number; title: string; error?: string }[] = [];

  for (const t of results) {
    let meta: AudioMetadata = {};
    let error: string | null = null;
    try {
      meta = await extractMetadata(dav, t.path, t.size);
    } catch (e) {
      error = e instanceof Error ? e.message : String(e);
    }
    try {
      const title = await saveTrack(c.env, dav, t, meta, error);
      processed.push({ id: t.id, title, ...(error ? { error } : {}) });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      await db.prepare(`UPDATE tracks SET status = 'error', error = ?, updated_at = ? WHERE id = ?`).bind(msg, Date.now(), t.id).run();
      processed.push({ id: t.id, title: t.path, error: msg });
    }
  }

  const remaining = await db.prepare(`SELECT COUNT(*) AS n FROM tracks WHERE status = 'pending'`).first<{ n: number }>();
  return c.json({ processed, remaining: remaining?.n ?? 0 });
});

async function sha1(data: Uint8Array): Promise<string> {
  const d = await crypto.subtle.digest('SHA-1', data);
  return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

interface ArtworkSource {
  path: string;
  offset: number;
}

async function storeArtwork(
  db: D1Database,
  mime: string,
  data: Uint8Array,
  source?: ArtworkSource,
): Promise<string | null> {
  if (!data.length) return null;
  const id = await sha1(data);
  const detectedMime = artworkMime('', data, mime);
  if (data.length <= MAX_ART_BYTES) {
    await db.prepare('INSERT OR IGNORE INTO artworks (id, mime, data) VALUES (?, ?, ?)').bind(id, detectedMime, data).run();
  } else if (source) {
    await db.prepare(
      `INSERT INTO artwork_sources (id, mime, path, byte_start, byte_length)
       VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET mime = excluded.mime, path = excluded.path,
         byte_start = excluded.byte_start, byte_length = excluded.byte_length`,
    ).bind(id, detectedMime, source.path, source.offset, data.length).run();
  } else {
    return null;
  }
  return id;
}

async function saveTrack(
  env: Env,
  dav: WebDAV,
  t: { id: number; path: string; size: number; lrc_path: string | null; cover_path: string | null },
  meta: AudioMetadata,
  error: string | null,
): Promise<string> {
  const db = env.DB;
  const guess = guessFromFilename(t.path);
  const folder = parentDir(t.path);
  const folderName = folder === normalizePath(env.MUSIC_ROOT || '/') ? '' : folder.slice(folder.lastIndexOf('/') + 1);

  const title = meta.title || guess.title;
  const artist = meta.artist || guess.artist || meta.albumArtist || '未知歌手';
  const albumArtist = meta.albumArtist || artist;
  const albumTitle = meta.album || folderName || '未知專輯';

  const upsertArtist = (name: string) =>
    db.prepare('INSERT INTO artists (name) VALUES (?) ON CONFLICT(name) DO UPDATE SET name = artists.name RETURNING id')
      .bind(name)
      .first<{ id: number }>();

  const artistRow = await upsertArtist(artist);
  const albumArtistRow = albumArtist.toLowerCase() === artist.toLowerCase() ? artistRow : await upsertArtist(albumArtist);

  const album = await db
    .prepare(
      `INSERT INTO albums (title, artist_id, year, created_at) VALUES (?, ?, ?, ?)
       ON CONFLICT(title, artist_id) DO UPDATE SET year = COALESCE(albums.year, excluded.year)
       RETURNING id, artwork_id`,
    )
    .bind(albumTitle, albumArtistRow!.id, meta.year ?? null, Date.now())
    .first<{ id: number; artwork_id: string | null }>();

  // Artwork: keep per-track embedded art, while an explicit folder cover is
  // authoritative for the album and may replace an older album image.
  let trackArt: string | null = null;
  if (meta.picture) {
    trackArt = await storeArtwork(
      db,
      meta.picture.mime,
      meta.picture.data,
      meta.picture.offset === undefined ? undefined : { path: t.path, offset: meta.picture.offset },
    );
  }
  let folderArt: string | null = null;
  if (t.cover_path) {
    try {
      const res = await dav.fetchFile(t.cover_path);
      if (res.ok) {
        const buf = new Uint8Array(await res.arrayBuffer());
        folderArt = await storeArtwork(db, artworkMime(t.cover_path, buf), buf);
      }
    } catch {
      /* cover is optional */
    }
  }
  const albumArt = folderArt ?? album!.artwork_id ?? trackArt;

  // Lyrics: sidecar .lrc wins over embedded text (it is usually the synced one).
  let lyrics: { content: string; source: string } | null = null;
  if (t.lrc_path) {
    try {
      const text = (await dav.readText(t.lrc_path)).trim();
      if (text) lyrics = { content: text, source: 'lrc' };
    } catch {
      /* fall through to embedded */
    }
  }
  if (!lyrics && meta.lyrics) lyrics = { content: meta.lyrics, source: 'embedded' };

  const now = Date.now();
  const stmts = [
    db.prepare(
      `UPDATE tracks SET status = 'ready', error = ?, title = ?, artist = ?, artist_id = ?, album_id = ?,
         track_no = ?, disc_no = ?, year = ?, genre = ?, record_label = ?, duration = ?, codec = ?, bitrate = ?,
         sample_rate = ?, bit_depth = ?, channels = ?, artwork_id = ?, has_lyrics = ?, metadata_version = 1, updated_at = ?
       WHERE id = ?`,
    ).bind(
      error,
      title,
      artist,
      artistRow!.id,
      album!.id,
      meta.trackNo ?? guess.trackNo ?? null,
      meta.discNo ?? null,
      meta.year ?? null,
      meta.genre ?? null,
      meta.recordLabel ?? null,
      meta.duration ?? null,
      meta.codec ?? extOf(t.path),
      meta.bitrate ?? null,
      meta.sampleRate ?? null,
      meta.bitDepth ?? null,
      meta.channels ?? null,
      trackArt,
      lyrics ? 1 : 0,
      now,
      t.id,
    ),
    lyrics
      ? db.prepare('INSERT OR REPLACE INTO lyrics (track_id, content, synced, source) VALUES (?, ?, ?, ?)').bind(
          t.id,
          lyrics.content,
          LRC_SYNCED.test(lyrics.content) ? 1 : 0,
          lyrics.source,
        )
      : db.prepare('DELETE FROM lyrics WHERE track_id = ?').bind(t.id),
  ];
  if (albumArt && albumArt !== album!.artwork_id) {
    stmts.push(db.prepare('UPDATE albums SET artwork_id = ? WHERE id = ?').bind(albumArt, album!.id));
  }
  await db.batch(stmts);
  return title;
}

sync.post('/finalize', async (c) => {
  const { scanId, dir } = await c.req.json<{ scanId: string; dir?: string }>();
  const root = normalizePath(c.env.MUSIC_ROOT || '/');
  const scanned = assertInRoot(c.env, dir || root);
  const prefix = scanned === '/' ? '/%' : `${scanned}/%`;
  const db = c.env.DB;
  const removed = await db
    .prepare(`DELETE FROM tracks WHERE path LIKE ? AND (scan_id IS NULL OR scan_id != ?) RETURNING id`)
    .bind(prefix, scanId)
    .all();
  await db.batch([
    db.prepare('DELETE FROM albums WHERE id NOT IN (SELECT DISTINCT album_id FROM tracks WHERE album_id IS NOT NULL)'),
    db.prepare(
      `DELETE FROM artists WHERE id NOT IN (SELECT DISTINCT artist_id FROM tracks WHERE artist_id IS NOT NULL)
         AND id NOT IN (SELECT DISTINCT artist_id FROM albums)`,
    ),
    db.prepare(
      `DELETE FROM artworks WHERE id NOT IN (SELECT artwork_id FROM tracks WHERE artwork_id IS NOT NULL)
         AND id NOT IN (SELECT artwork_id FROM albums WHERE artwork_id IS NOT NULL)`,
    ),
    db.prepare(
      `DELETE FROM artwork_sources WHERE id NOT IN (SELECT artwork_id FROM tracks WHERE artwork_id IS NOT NULL)
         AND id NOT IN (SELECT artwork_id FROM albums WHERE artwork_id IS NOT NULL)`,
    ),
  ]);
  return c.json({ removed: removed.results.length });
});

/** Mark tracks for re-extraction (all, or only those that failed). */
sync.post('/reset', async (c) => {
  const { scope } = await c.req.json<{ scope: 'errors' | 'all' }>();
  const sql =
    scope === 'all'
      ? `UPDATE tracks SET status = 'pending'`
      : `UPDATE tracks SET status = 'pending' WHERE error IS NOT NULL OR status = 'error'`;
  const r = await c.env.DB.prepare(sql).run();
  return c.json({ reset: r.meta.changes });
});

/** Connection check used by the settings page. */
sync.get('/ping', async (c) => {
  const dav = new WebDAV(c.env);
  const root = normalizePath(c.env.MUSIC_ROOT || '/');
  const entries = await dav.list(root);
  return c.json({ ok: true, root, entries: entries.length });
});

export default sync;
