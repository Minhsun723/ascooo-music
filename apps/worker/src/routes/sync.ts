import { Hono } from 'hono';
import { HTTPException } from 'hono/http-exception';
import type { AppEnv, Env } from '../env';
import { requireAdmin, requireSessionAdmin } from '../lib/auth';
import { ARTWORK_ASSET_VERSION, ARTWORK_SIZES, artworkObjectKey, isArtworkSize, type ArtworkSize } from '../lib/artwork';
import { type AlternateSource, aac51Root, pairAac51 } from '../lib/aac51';
import { AUDIO_EXTENSIONS, type AudioMetadata, METADATA_VERSION, extOf, extractMetadata, guessFromFilename } from '../lib/metadata';
import { artistSearchKey, searchKey, trackSearchKey } from '../lib/search';
import { type DavEntry, WebDAV, normalizePath, parentDir } from '../lib/webdav';

/**
 * Sync is driven by the browser in small steps so each Worker invocation stays
 * well within subrequest/CPU limits:
 *   1. POST /list      — PROPFIND one folder, upsert audio files as `pending`
 *   2. POST /process   — extract tags for a few pending files, write to D1
 *   3. POST /finalize  — drop rows for files that no longer exist on PikPak
 */
const sync = new Hono<AppEnv>();
sync.use('*', (c, next) => {
  // Artwork imports are content-addressed R2 writes. Trusting the signed admin
  // session here avoids one D1 read per cover during a large local sync.
  const guard = c.req.path.endsWith('/import/artwork') ? requireSessionAdmin : requireAdmin;
  return guard(c, next);
});

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
          -- Stays at 1: re-parsing here drops Apple Music lyrics and artist merges,
          -- so newer metadata versions are only backfilled by the local sync.
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
    .prepare(
      `SELECT id, path, size, lrc_path, cover_path, display_title, display_artist
       FROM tracks WHERE status = 'pending' ORDER BY id LIMIT ?`,
    )
    .bind(limit + 1)
    .all<PendingTrack>();
  const hasMore = results.length > limit;

  const dav = new WebDAV(c.env);
  const processed: { id: number; title: string; error?: string }[] = [];

  for (const t of results.slice(0, limit)) {
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

  return c.json({ processed, hasMore });
});

async function sha1(data: Uint8Array): Promise<string> {
  const d = await crypto.subtle.digest('SHA-1', data);
  return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

interface ArtworkSource {
  path: string;
  offset: number;
}

interface ImportedArtworkVariant {
  size: ArtworkSize;
  width: number;
  height: number;
  checksum: string;
  data: string;
}

interface ImportedArtwork {
  id: string;
  variants: ImportedArtworkVariant[];
}

interface ImportedTrack {
  scanId: string;
  path: string;
  size: number;
  etag: string | null;
  mtime: number | null;
  lrcPath: string | null;
  coverPath: string | null;
  coverSignature: string | null;
  metadata: Omit<AudioMetadata, 'picture' | 'lyrics'>;
  metadataError: string | null;
  lyrics: {
    content: string;
    source: 'lrc' | 'ttml' | 'embedded' | 'apple-music';
    format: 'lrc' | 'ttml' | 'plain';
  } | null;
  appleMusic: {
    songId: string;
    isrc: string | null;
    artistName: string;
    displayTitle: string | null;
    displayArtist: string | null;
    artistId: string | null;
    artistArtworkId: string | null;
    confidence: number;
  } | null;
  trackArtworkId: string | null;
  folderArtworkId: string | null;
  aac51?: AlternateSource | null;
  /** Apple identity of the album artist, taken from the album's own tracks by that artist. */
  albumArtistApple?: { artistId: string; artistName: string } | null;
  /** Apple's genre, or the tag translated through Apple's names; metadata.genre keeps the tag. */
  displayGenre?: { zh: string | null; en: string } | null;
  /** Local-sync hash of this payload; stored so an unchanged track is not uploaded again. */
  syncHash?: string | null;
}

interface ArtistEnrichment {
  appleMusicId: string;
  appleMusicName: string;
  displayName: string | null;
  artworkId: string | null;
}

/**
 * Apple artist IDs identify the first/primary artist on a song, so the ID by
 * itself is not unique for collaborations. Pair it with Apple's full artist
 * credit: aliases such as "Riria." / "りりあ。" then converge, while
 * "9Lana" / "9Lana & AKUGETSU" remain separate artist pages.
 */
async function upsertArtist(
  db: D1Database,
  name: string,
  enrichment: ArtistEnrichment | null = null,
): Promise<{ id: number }> {
  if (enrichment) {
    const existing = await db.prepare(
      `UPDATE artists
       SET display_name = COALESCE(?3, display_name),
         artwork_id = COALESCE(?4, artwork_id)
       WHERE apple_music_id = ?1 AND apple_music_name = ?2 COLLATE NOCASE
       RETURNING id, name, display_name, search_key`,
    ).bind(
      enrichment.appleMusicId,
      enrichment.appleMusicName,
      enrichment.displayName,
      enrichment.artworkId,
    ).first<ArtistRow>();
    if (existing) return syncArtistSearchKey(db, existing);
  }

  const row = await db.prepare(
    `INSERT INTO artists (name, display_name, apple_music_id, apple_music_name, artwork_id, search_key)
     VALUES (?1, ?2, ?3, ?4, ?5, ?6)
     ON CONFLICT DO UPDATE SET
       display_name = COALESCE(excluded.display_name, artists.display_name),
       apple_music_id = COALESCE(artists.apple_music_id, excluded.apple_music_id),
       apple_music_name = COALESCE(artists.apple_music_name, excluded.apple_music_name),
       artwork_id = COALESCE(excluded.artwork_id, artists.artwork_id)
     RETURNING id, name, display_name, search_key`,
  ).bind(
    name,
    enrichment?.displayName ?? null,
    enrichment?.appleMusicId ?? null,
    enrichment?.appleMusicName ?? null,
    enrichment?.artworkId ?? null,
    artistSearchKey(name, enrichment?.displayName),
  ).first<ArtistRow>();
  if (!row) throw new Error(`無法建立藝人：${name}`);
  return syncArtistSearchKey(db, row);
}

interface ArtistRow {
  id: number;
  name: string;
  display_name: string | null;
  search_key: string | null;
}

/**
 * An upsert may land on an existing row whose stored name differs from the
 * one passed in (Apple aliases, NOCASE matches), so derive the key from the
 * row as stored. Only writes when the key actually changed.
 */
async function syncArtistSearchKey(db: D1Database, row: ArtistRow): Promise<{ id: number }> {
  const key = artistSearchKey(row.name, row.display_name);
  if (key !== row.search_key) {
    await db.prepare('UPDATE artists SET search_key = ? WHERE id = ?').bind(key, row.id).run();
  }
  return { id: row.id };
}

function decodeBase64(value: string): Uint8Array {
  const raw = atob(value);
  const data = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) data[i] = raw.charCodeAt(i);
  return data;
}

async function sha256(data: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', data);
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

function isWebp(data: Uint8Array): boolean {
  return data.length >= 12 &&
    data[0] === 0x52 && data[1] === 0x49 && data[2] === 0x46 && data[3] === 0x46 &&
    data[8] === 0x57 && data[9] === 0x45 && data[10] === 0x42 && data[11] === 0x50;
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

/**
 * Report which artwork IDs are missing a size in R2, so the local sync only
 * sends images R2 does not already hold. IDs are content hashes, so an ID that
 * is present always has the exact same pixels. One listing covers the bucket
 * instead of a HEAD per image.
 */
sync.post('/import/artwork/missing', async (c) => {
  const { ids } = await c.req.json<{ ids?: unknown }>();
  if (!Array.isArray(ids) || ids.length > 20_000 || ids.some((id) => typeof id !== 'string' || !/^[a-f0-9]{40}$/.test(id))) {
    throw new HTTPException(400, { message: '封面 ID 清單格式錯誤' });
  }
  const prefix = `art/${ARTWORK_ASSET_VERSION}/`;
  const stored = new Set<string>();
  let cursor: string | undefined;
  do {
    const page = await c.env.ARTWORK.list({ prefix, cursor, limit: 1000 });
    for (const object of page.objects) stored.add(object.key);
    cursor = page.truncated ? page.cursor : undefined;
  } while (cursor);
  const missing = (ids as string[]).filter((id) => ARTWORK_SIZES.some((size) => !stored.has(artworkObjectKey(id, size))));
  return c.json({ missing });
});

/**
 * The local sync command does all WebDAV reads and metadata parsing before it
 * contacts the Worker. The Worker only validates and persists the prepared
 * artwork, keeping expensive upstream I/O out of the request lifecycle.
 */
sync.post('/import/artwork', async (c) => {
  const artwork = await c.req.json<ImportedArtwork>();
  if (!artwork || typeof artwork.id !== 'string' || !/^[a-f0-9]{40}$/.test(artwork.id)) {
    throw new HTTPException(400, { message: '封面 ID 格式錯誤' });
  }
  if (!Array.isArray(artwork.variants)) throw new HTTPException(400, { message: '缺少封面尺寸' });
  if (artwork.variants.length !== ARTWORK_SIZES.length || artwork.variants.some((variant) => !variant || !isArtworkSize(variant.size))) {
    throw new HTTPException(400, { message: `封面必須包含 ${ARTWORK_SIZES.join('、')} px 尺寸` });
  }

  const variants = new Map(artwork.variants.map((variant) => [variant.size, variant]));
  if (variants.size !== ARTWORK_SIZES.length || ARTWORK_SIZES.some((size) => !variants.has(size))) {
    throw new HTTPException(400, { message: `封面必須包含 ${ARTWORK_SIZES.join('、')} px 尺寸` });
  }

  const existing = await Promise.all(ARTWORK_SIZES.map((size) => c.env.ARTWORK.head(artworkObjectKey(artwork.id, size))));
  const uploaded: ArtworkSize[] = [];
  for (let index = 0; index < ARTWORK_SIZES.length; index++) {
    if (existing[index]) continue;
    const size = ARTWORK_SIZES[index];
    const variant = variants.get(size)!;
    if (!Number.isInteger(variant.width) || !Number.isInteger(variant.height) ||
        variant.width < 1 || variant.height < 1 || variant.width > size || variant.height > size) {
      throw new HTTPException(400, { message: `${size} px 封面尺寸錯誤` });
    }
    if (!/^[a-f0-9]{64}$/.test(variant.checksum)) {
      throw new HTTPException(400, { message: `${size} px 封面校驗碼錯誤` });
    }
    if (typeof variant.data !== 'string') {
      throw new HTTPException(400, { message: `${size} px 封面內容格式錯誤` });
    }
    const data = decodeBase64(variant.data);
    if (!data.length || data.length > 20_000_000 || !isWebp(data)) {
      throw new HTTPException(400, { message: `${size} px 封面不是有效的 WebP` });
    }
    if (await sha256(data) !== variant.checksum) {
      throw new HTTPException(400, { message: `${size} px 封面內容校驗失敗` });
    }
    await c.env.ARTWORK.put(artworkObjectKey(artwork.id, size), data, {
      httpMetadata: {
        contentType: 'image/webp',
        cacheControl: 'public, max-age=31536000, immutable',
      },
      customMetadata: {
        artworkId: artwork.id,
        checksum: variant.checksum,
        width: String(variant.width),
        height: String(variant.height),
      },
    });
    uploaded.push(size);
  }

  return c.json({ id: artwork.id, existing: uploaded.length === 0, uploaded });
});

/** Sync hashes of every imported track, so the local sync uploads only what changed. */
sync.post('/import/track/hashes', async (c) => {
  const { results } = await c.env.DB
    .prepare('SELECT path, sync_hash FROM tracks WHERE sync_hash IS NOT NULL')
    .all<{ path: string; sync_hash: string }>();
  return c.json({ hashes: Object.fromEntries(results.map((row) => [row.path, row.sync_hash])) });
});

/** Persist one track already parsed by the local sync command. */
sync.post('/import/track', async (c) => {
  const item = await c.req.json<ImportedTrack>();
  if (!item.scanId) throw new HTTPException(400, { message: '缺少 scanId' });
  const path = assertInRoot(c.env, item.path);
  if (!Number.isFinite(item.size) || item.size < 0) throw new HTTPException(400, { message: '音訊大小格式錯誤' });
  if (item.lyrics) {
    if (!['lrc', 'ttml', 'plain'].includes(item.lyrics.format) ||
        !['lrc', 'ttml', 'embedded', 'apple-music'].includes(item.lyrics.source)) {
      throw new HTTPException(400, { message: '歌詞格式錯誤' });
    }
    if (!item.lyrics.content || new TextEncoder().encode(item.lyrics.content).length > 1_500_000) {
      throw new HTTPException(400, { message: '歌詞內容為空或超過 1.5 MB' });
    }
  }
  const aac51 = item.aac51 ? validAac51(c.env, item.aac51) : null;
  if (item.syncHash != null && !/^[a-f0-9]{64}$/.test(item.syncHash)) {
    throw new HTTPException(400, { message: '同步校驗碼格式錯誤' });
  }
  if (item.appleMusic) {
    if (!/^\d+$/.test(item.appleMusic.songId) ||
        item.appleMusic.artistId !== null && !/^\d+$/.test(item.appleMusic.artistId) ||
        item.appleMusic.artistArtworkId !== null && !/^[a-f0-9]{40}$/.test(item.appleMusic.artistArtworkId) ||
        !Number.isInteger(item.appleMusic.confidence) || item.appleMusic.confidence < 0 || item.appleMusic.confidence > 100) {
      throw new HTTPException(400, { message: 'Apple Music 配對資料格式錯誤' });
    }
  }
  if (item.albumArtistApple && (!/^\d+$/.test(item.albumArtistApple.artistId) ||
      typeof item.albumArtistApple.artistName !== 'string' || !item.albumArtistApple.artistName.trim())) {
    throw new HTTPException(400, { message: '專輯歌手 Apple Music 資料格式錯誤' });
  }
  if (item.displayGenre && (typeof item.displayGenre.en !== 'string' || !item.displayGenre.en.trim() ||
      item.displayGenre.zh !== null && typeof item.displayGenre.zh !== 'string')) {
    throw new HTTPException(400, { message: '曲風資料格式錯誤' });
  }

  const meta = item.metadata ?? {};
  const guess = guessFromFilename(path);
  const apple = item.appleMusic;
  const folder = parentDir(path);
  const folderName = folder === normalizePath(c.env.MUSIC_ROOT || '/') ? '' : folder.slice(folder.lastIndexOf('/') + 1);
  const title = nfc(meta.title || guess.title);
  const artist = nfc(meta.artist || guess.artist || meta.albumArtist || apple?.artistName?.trim() || '未知歌手');
  const albumArtist = nfc(meta.albumArtist) || artist;
  const albumTitle = nfc(meta.album || folderName || '未知專輯');
  const db = c.env.DB;
  const displayTitle = nfc(apple?.displayTitle?.trim().slice(0, 500)) || null;
  const displayArtist = nfc(apple?.displayArtist?.trim().slice(0, 500)) || null;
  const genreZh = nfc(item.displayGenre?.zh?.trim().slice(0, 200)) || null;
  const genreEn = nfc(item.displayGenre?.en.trim().slice(0, 200)) || null;
  const artistEnrichment = apple?.artistId && apple.artistName.trim()
    ? {
        appleMusicId: apple.artistId,
        appleMusicName: apple.artistName.trim().slice(0, 500),
        displayName: displayArtist,
        artworkId: apple.artistArtworkId,
      }
    : null;
  // Without it an alias album artist ("Riria.") misses the row its own tracks
  // merged into through Apple ("りりあ。") and the album splits in two.
  const albumArtistEnrichment = item.albumArtistApple
    ? {
        appleMusicId: item.albumArtistApple.artistId,
        appleMusicName: item.albumArtistApple.artistName.trim().slice(0, 500),
        displayName: null,
        artworkId: null,
      }
    : null;

  const artistRow = await upsertArtist(db, artist, artistEnrichment);
  const albumArtistRow = albumArtist.toLowerCase() === artist.toLowerCase()
    ? artistRow
    : await upsertArtist(db, albumArtist, albumArtistEnrichment);
  const album = await upsertAlbum(db, albumTitle, albumArtistRow!.id, meta.year);

  // Display names survive a sync without an Apple match (COALESCE below), so
  // the search key has to be built from the values the row will end up with.
  const previous = await db.prepare('SELECT display_title, display_artist FROM tracks WHERE path = ?')
    .bind(path)
    .first<{ display_title: string | null; display_artist: string | null }>();
  const key = trackSearchKey({
    title,
    artist,
    displayTitle: displayTitle ?? previous?.display_title,
    displayArtist: displayArtist ?? previous?.display_artist,
  });

  const now = Date.now();
  const row = await db.prepare(
    `INSERT INTO tracks (
       path, lrc_path, cover_path, cover_signature, size, etag, mtime, scan_id, status, error,
       title, artist, artist_id, album_id, track_no, disc_no, year, genre, record_label,
       duration, codec, bitrate, sample_rate, bit_depth, channels, artwork_id, has_lyrics,
       display_title, display_artist, genre_zh, genre_en, apple_music_id, apple_isrc, search_key,
       alt_path, alt_size, alt_etag, copyright, release_date, sync_hash, metadata_version, added_at, updated_at
     ) VALUES (
       ?, ?, ?, ?, ?, ?, ?, ?, 'ready', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ${METADATA_VERSION}, ?, ?
     )
     ON CONFLICT(path) DO UPDATE SET
       lrc_path = excluded.lrc_path, cover_path = excluded.cover_path,
       cover_signature = excluded.cover_signature, size = excluded.size, etag = excluded.etag,
       mtime = excluded.mtime, scan_id = excluded.scan_id, status = 'ready', error = excluded.error,
       title = excluded.title, artist = excluded.artist, artist_id = excluded.artist_id,
       album_id = excluded.album_id, track_no = excluded.track_no, disc_no = excluded.disc_no,
       year = excluded.year, genre = excluded.genre, record_label = excluded.record_label,
       duration = excluded.duration, codec = excluded.codec, bitrate = excluded.bitrate,
       sample_rate = excluded.sample_rate, bit_depth = excluded.bit_depth, channels = excluded.channels,
       artwork_id = excluded.artwork_id, has_lyrics = excluded.has_lyrics,
       display_title = COALESCE(excluded.display_title, tracks.display_title),
       display_artist = COALESCE(excluded.display_artist, tracks.display_artist),
       -- Like the display names, but kept as a pair: every known genre has an English name.
       genre_zh = CASE WHEN excluded.genre_en IS NULL THEN tracks.genre_zh ELSE excluded.genre_zh END,
       genre_en = COALESCE(excluded.genre_en, tracks.genre_en),
       apple_music_id = COALESCE(excluded.apple_music_id, tracks.apple_music_id),
       apple_isrc = COALESCE(excluded.apple_isrc, tracks.apple_isrc),
       search_key = excluded.search_key,
       alt_path = excluded.alt_path, alt_size = excluded.alt_size, alt_etag = excluded.alt_etag,
       copyright = excluded.copyright, release_date = excluded.release_date, sync_hash = excluded.sync_hash,
       metadata_version = excluded.metadata_version, updated_at = excluded.updated_at
     RETURNING id`,
  ).bind(
    path,
    item.lrcPath,
    item.coverPath,
    item.coverSignature,
    Math.floor(item.size),
    item.etag,
    item.mtime,
    item.scanId,
    item.metadataError,
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
    meta.codec ?? extOf(path),
    meta.bitrate ?? null,
    meta.sampleRate ?? null,
    meta.bitDepth ?? null,
    meta.channels ?? null,
    item.trackArtworkId,
    item.lyrics ? 1 : 0,
    displayTitle,
    displayArtist,
    genreZh,
    genreEn,
    apple?.songId ?? null,
    apple?.isrc ?? null,
    key,
    aac51?.path ?? null,
    aac51?.size ?? null,
    aac51?.etag ?? null,
    meta.copyright ?? null,
    meta.releaseDate ?? null,
    item.syncHash ?? null,
    now,
    now,
  ).first<{ id: number }>();

  const statements = item.lyrics
    ? [db.prepare(
        `INSERT INTO lyrics (track_id, content, synced, source, format) VALUES (?, ?, ?, ?, ?)
         ON CONFLICT(track_id) DO UPDATE SET content = excluded.content, synced = excluded.synced,
           source = excluded.source, format = excluded.format
         WHERE lyrics.content IS NOT excluded.content OR lyrics.synced IS NOT excluded.synced
           OR lyrics.source IS NOT excluded.source OR lyrics.format IS NOT excluded.format`,
      ).bind(
        row!.id,
        item.lyrics.content,
        item.lyrics.format !== 'plain' || LRC_SYNCED.test(item.lyrics.content) ? 1 : 0,
        item.lyrics.source,
        item.lyrics.format,
      )]
    : [db.prepare('DELETE FROM lyrics WHERE track_id = ?').bind(row!.id)];
  const albumArtworkId = item.folderArtworkId ?? album!.artwork_id ?? item.trackArtworkId;
  if (albumArtworkId && albumArtworkId !== album!.artwork_id) {
    statements.push(db.prepare('UPDATE albums SET artwork_id = ? WHERE id = ?').bind(albumArtworkId, album!.id));
  }
  await db.batch(statements);
  return c.json({ id: row!.id, title: displayTitle ?? title });
});

/** Validate an AAC 5.1 file reported by the local sync and return it normalized. */
function validAac51(env: Env, file: AlternateSource): AlternateSource {
  const root = aac51Root(env.AAC51_ROOT);
  const path = typeof file?.path === 'string' ? normalizePath(file.path) : '';
  if (root === '/' || !path.startsWith(`${root}/`) || path.split('/').includes('..') || extOf(path) !== 'm4a' ||
      !Number.isFinite(file.size) || file.size < 0 || (file.etag != null && typeof file.etag !== 'string')) {
    throw new HTTPException(400, { message: `AAC 5.1 檔案必須是位於 ${root} 之內的 m4a` });
  }
  return { path, size: Math.floor(file.size), etag: file.etag ?? null };
}

/**
 * Re-pair AAC 5.1 copies without re-importing any track: the local command
 * only lists AAC51_ROOT, and the Worker matches it against every track in D1.
 * Only rows whose pairing changed are written.
 */
sync.post('/aac51', async (c) => {
  const { files: raw } = await c.req.json<{ files?: unknown }>();
  if (!Array.isArray(raw) || raw.length > 20_000) throw new HTTPException(400, { message: 'AAC 5.1 檔案清單格式錯誤' });
  const files = (raw as AlternateSource[]).map((file) => validAac51(c.env, file));
  const db = c.env.DB;
  const { results: tracks } = await db
    .prepare('SELECT id, path, alt_path, alt_size, alt_etag FROM tracks')
    .all<{ id: number; path: string; alt_path: string | null; alt_size: number | null; alt_etag: string | null }>();
  const { pairs, ambiguous, orphans } = pairAac51(tracks.map((track) => track.path), files);
  const changes = tracks.flatMap((track) => {
    const alt = pairs.get(track.path) ?? null;
    const unchanged = (alt?.path ?? null) === track.alt_path &&
      (alt?.size ?? null) === track.alt_size &&
      (alt?.etag ?? null) === track.alt_etag;
    return unchanged ? [] : [{ id: track.id, path: alt?.path ?? null, size: alt?.size ?? null, etag: alt?.etag ?? null }];
  });
  if (changes.length) {
    // One statement for any number of rows stays within D1's per-request query limit.
    await db.prepare(
      `UPDATE tracks SET alt_path = u.path, alt_size = u.size, alt_etag = u.etag
       FROM (
         SELECT json_extract(value, '$.id') AS id, json_extract(value, '$.path') AS path,
                json_extract(value, '$.size') AS size, json_extract(value, '$.etag') AS etag
         FROM json_each(?)
       ) AS u
       WHERE tracks.id = u.id`,
    ).bind(JSON.stringify(changes)).run();
  }
  return c.json({ paired: pairs.size, changed: changes.length, ambiguous, orphans });
});

/** Tag text is stored composed so equal names share one artist/album row. */
const nfc = (value: string | null | undefined) => (value ?? '').normalize('NFC');

async function upsertAlbum(db: D1Database, title: string, artistId: number, year: number | undefined) {
  return db
    .prepare(
      `INSERT INTO albums (title, artist_id, year, created_at, search_key) VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(title, artist_id) DO UPDATE SET year = COALESCE(albums.year, excluded.year),
         search_key = excluded.search_key
       RETURNING id, artwork_id`,
    )
    .bind(title, artistId, year ?? null, Date.now(), searchKey(title))
    .first<{ id: number; artwork_id: string | null }>();
}

interface PendingTrack {
  id: number;
  path: string;
  size: number;
  lrc_path: string | null;
  cover_path: string | null;
  display_title: string | null;
  display_artist: string | null;
}

async function saveTrack(
  env: Env,
  dav: WebDAV,
  t: PendingTrack,
  meta: AudioMetadata,
  error: string | null,
): Promise<string> {
  const db = env.DB;
  const guess = guessFromFilename(t.path);
  const folder = parentDir(t.path);
  const folderName = folder === normalizePath(env.MUSIC_ROOT || '/') ? '' : folder.slice(folder.lastIndexOf('/') + 1);

  const title = nfc(meta.title || guess.title);
  const artist = nfc(meta.artist || guess.artist || meta.albumArtist || '未知歌手');
  const albumArtist = nfc(meta.albumArtist) || artist;
  const albumTitle = nfc(meta.album || folderName || '未知專輯');

  const artistRow = await upsertArtist(db, artist);
  const albumArtistRow = albumArtist.toLowerCase() === artist.toLowerCase()
    ? artistRow
    : await upsertArtist(db, albumArtist);

  const album = await upsertAlbum(db, albumTitle, albumArtistRow!.id, meta.year);

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
         sample_rate = ?, bit_depth = ?, channels = ?, artwork_id = ?, has_lyrics = ?, search_key = ?,
         copyright = ?, release_date = ?, sync_hash = NULL, metadata_version = ${METADATA_VERSION}, updated_at = ?
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
      trackSearchKey({ title, artist, displayTitle: t.display_title, displayArtist: t.display_artist }),
      meta.copyright ?? null,
      meta.releaseDate ?? null,
      now,
      t.id,
    ),
    lyrics
      ? db.prepare('INSERT OR REPLACE INTO lyrics (track_id, content, synced, source, format) VALUES (?, ?, ?, ?, ?)').bind(
          t.id,
          lyrics.content,
          LRC_SYNCED.test(lyrics.content) ? 1 : 0,
          lyrics.source,
          LRC_SYNCED.test(lyrics.content) ? 'lrc' : 'plain',
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
  const { scanId, dir, artworkIds: rawArtworkIds, paths: rawPaths } = await c.req.json<{
    scanId: string;
    dir?: string;
    artworkIds?: string[];
    /** Every audio path the local sync found. It skips unchanged tracks, so their scan_id is stale. */
    paths?: string[];
  }>();
  const root = normalizePath(c.env.MUSIC_ROOT || '/');
  const scanned = assertInRoot(c.env, dir || root);
  const prefix = scanned === '/' ? '/' : `${scanned}/`;
  const prefixEnd = `${prefix}\u{10ffff}`;
  const db = c.env.DB;
  const artworkIds = [...new Set((rawArtworkIds ?? []).filter((id) => /^[a-f0-9]{40}$/.test(id)))];
  if (artworkIds.length !== (rawArtworkIds?.length ?? 0) || artworkIds.length > 20_000) {
    throw new HTTPException(400, { message: '封面清理清單格式錯誤' });
  }
  if (rawPaths !== undefined && (!Array.isArray(rawPaths) || !rawPaths.length || rawPaths.length > 50_000 ||
      rawPaths.some((path) => typeof path !== 'string'))) {
    throw new HTTPException(400, { message: '歌曲清單格式錯誤' });
  }
  const removed = await (rawPaths
    ? db
        .prepare(`DELETE FROM tracks WHERE path >= ? AND path < ? AND path NOT IN (SELECT value FROM json_each(?)) RETURNING id`)
        .bind(prefix, prefixEnd, JSON.stringify(rawPaths.map((path) => normalizePath(path))))
    : db
        .prepare(`DELETE FROM tracks WHERE path >= ? AND path < ? AND (scan_id IS NULL OR scan_id != ?) RETURNING id`)
        .bind(prefix, prefixEnd, scanId)
  ).all();
  await db.batch([
    db.prepare('DELETE FROM albums WHERE NOT EXISTS (SELECT 1 FROM tracks WHERE tracks.album_id = albums.id)'),
    db.prepare(
      `DELETE FROM artists
       WHERE NOT EXISTS (SELECT 1 FROM tracks WHERE tracks.artist_id = artists.id)
         AND NOT EXISTS (SELECT 1 FROM albums WHERE albums.artist_id = artists.id)`,
    ),
    db.prepare(
      `DELETE FROM artworks
       WHERE NOT EXISTS (SELECT 1 FROM tracks WHERE tracks.artwork_id = artworks.id)
         AND NOT EXISTS (SELECT 1 FROM albums WHERE albums.artwork_id = artworks.id)`,
    ),
    db.prepare(
      `DELETE FROM artwork_sources
       WHERE NOT EXISTS (SELECT 1 FROM tracks WHERE tracks.artwork_id = artwork_sources.id)
         AND NOT EXISTS (SELECT 1 FROM albums WHERE albums.artwork_id = artwork_sources.id)`,
    ),
    ...(artworkIds.length ? [
      db.prepare('DELETE FROM artworks WHERE id IN (SELECT value FROM json_each(?))').bind(JSON.stringify(artworkIds)),
      db.prepare('DELETE FROM artwork_sources WHERE id IN (SELECT value FROM json_each(?))').bind(JSON.stringify(artworkIds)),
    ] : []),
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
