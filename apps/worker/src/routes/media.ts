import { Hono, type Context } from 'hono';
import { HTTPException } from 'hono/http-exception';
import type { AppEnv } from '../env';
import { ARTWORK_ASSET_VERSION, artworkObjectKey, isArtworkSize } from '../lib/artwork';
import { readSession } from '../lib/auth';
import { WebDAV } from '../lib/webdav';

/** Album art is public so signed-out visitors can browse; mounted ahead of requireUser. */
export const artwork = new Hono<AppEnv>();
const media = new Hono<AppEnv>();

const MIME: Record<string, string> = {
  mp3: 'audio/mpeg',
  m4a: 'audio/mp4',
  mp4: 'audio/mp4',
  aac: 'audio/aac',
  flac: 'audio/flac',
  ogg: 'audio/ogg',
  opus: 'audio/ogg',
  wav: 'audio/wav',
};

/**
 * Stream the original file from PikPak, passing Range through so seeking works.
 * `?v=aac51` streams the track's AAC 5.1 copy instead of its Dolby Atmos original.
 */
media.get('/stream/:id', async (c) => {
  const variant = c.req.query('v');
  if (variant !== undefined && variant !== 'aac51') throw new HTTPException(400, { message: '不支援的音訊版本' });
  const track = await c.env.DB.prepare(
    "SELECT path, size, alt_path, alt_size FROM tracks WHERE id = ? AND status = 'ready' AND visible = 1",
  )
    .bind(Number(c.req.param('id')))
    .first<{ path: string; size: number; alt_path: string | null; alt_size: number | null }>();
  if (!track) throw new HTTPException(404, { message: '找不到這首歌' });
  if (variant && !track.alt_path) throw new HTTPException(404, { message: '這首歌沒有 AAC 5.1 版本' });
  const row = variant ? { path: track.alt_path!, size: track.alt_size ?? 0 } : track;

  const dav = new WebDAV(c.env);
  const range = c.req.header('range') ?? null;
  const upstream = await dav.fetchFile(row.path, { range });

  if (!upstream.ok && upstream.status !== 206) {
    if (upstream.status === 416) {
      return new Response(null, { status: 416, headers: { 'Content-Range': `bytes */${row.size}` } });
    }
    throw new HTTPException(502, { message: `PikPak 回應錯誤：HTTP ${upstream.status}` });
  }

  const ext = row.path.slice(row.path.lastIndexOf('.') + 1).toLowerCase();
  const headers = new Headers({
    'Content-Type': MIME[ext] ?? upstream.headers.get('content-type') ?? 'application/octet-stream',
    'Accept-Ranges': 'bytes',
    'Cache-Control': 'private, max-age=3600',
  });
  for (const h of ['content-length', 'content-range', 'etag', 'last-modified']) {
    const v = upstream.headers.get(h);
    if (v) headers.set(h, v);
  }
  return new Response(upstream.body, { status: upstream.status, headers });
});

function etagMatches(requestValue: string | undefined, etag: string): boolean {
  if (!requestValue) return false;
  return requestValue.split(',').some((value) => value.trim() === etag || value.trim() === '*');
}

async function legacyArtwork(c: Context<AppEnv>, id: string): Promise<Response> {
  const row = await c.env.DB.prepare('SELECT mime, data FROM artworks WHERE id = ?').bind(id).first<{ mime: string; data: ArrayBuffer | number[] }>();
  let mime: string;
  let data: ArrayBuffer | Uint8Array;
  if (row) {
    mime = row.mime;
    data = row.data instanceof ArrayBuffer ? row.data : new Uint8Array(row.data);
  } else {
    const source = await c.env.DB.prepare(
      'SELECT mime, path, byte_start, byte_length FROM artwork_sources WHERE id = ?',
    ).bind(id).first<{ mime: string; path: string; byte_start: number; byte_length: number }>();
    if (!source) throw new HTTPException(404, { message: '找不到封面' });
    mime = source.mime;
    data = await new WebDAV(c.env).readRange(source.path, source.byte_start, source.byte_start + source.byte_length - 1);
    if (data.byteLength !== source.byte_length) throw new HTTPException(502, { message: 'PikPak 封面資料不完整' });
  }
  const etag = `"legacy-${id}"`;
  const cacheControl = 'private, max-age=3600';
  if (etagMatches(c.req.header('if-none-match'), etag)) {
    return new Response(null, { status: 304, headers: { ETag: etag, 'Cache-Control': cacheControl } });
  }
  return new Response(data, {
    headers: {
      'Content-Type': mime,
      'Cache-Control': cacheControl,
      'X-Content-Type-Options': 'nosniff',
      ETag: etag,
    },
  });
}

/** Optimized album art lives in R2; legacy D1/PikPak data remains a migration fallback. */
async function serveArtwork(c: Context<AppEnv>): Promise<Response> {
  const id = c.req.param('id');
  if (!id || !/^[a-f0-9]{40}$/.test(id)) throw new HTTPException(404, { message: '找不到封面' });
  const rawSize = c.req.param('size');
  const size = rawSize === undefined ? 512 : Number(rawSize);
  if (!isArtworkSize(size)) throw new HTTPException(400, { message: '封面尺寸只支援 512 或 2000' });

  const cacheUrl = new URL(c.req.url);
  cacheUrl.search = `v=${ARTWORK_ASSET_VERSION}`;
  const cacheKey = new Request(cacheUrl.toString(), { method: 'GET' });
  const cache = caches.default;
  const cached = await cache.match(cacheKey);
  if (cached) {
    const etag = cached.headers.get('etag');
    if (etag && etagMatches(c.req.header('if-none-match'), etag)) {
      return new Response(null, { status: 304, headers: cached.headers });
    }
    return cached;
  }

  const object = await c.env.ARTWORK.get(artworkObjectKey(id, size));
  if (!object) {
    // The legacy fallback reads D1; keep signed-out traffic on R2 and the edge cache only.
    if (!(await readSession(c))) throw new HTTPException(404, { message: '找不到封面' });
    return legacyArtwork(c, id);
  }

  const headers = new Headers();
  object.writeHttpMetadata(headers);
  const etag = `"${ARTWORK_ASSET_VERSION}-${id}-${size}"`;
  headers.set('Content-Type', 'image/webp');
  headers.set('Cache-Control', 'public, max-age=31536000, immutable');
  headers.set('ETag', etag);
  headers.set('X-Content-Type-Options', 'nosniff');
  if (etagMatches(c.req.header('if-none-match'), etag)) {
    return new Response(null, { status: 304, headers });
  }

  const response = new Response(object.body, { headers });
  c.executionCtx.waitUntil(cache.put(cacheKey, response.clone()));
  return response;
}

artwork.get('/art/:id', serveArtwork);
artwork.get('/art/:id/:size', serveArtwork);

export default media;
