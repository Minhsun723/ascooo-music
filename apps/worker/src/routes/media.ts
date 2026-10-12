import { Hono } from 'hono';
import { HTTPException } from 'hono/http-exception';
import type { AppEnv } from '../env';
import { WebDAV } from '../lib/webdav';

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

/** Stream the original file from PikPak, passing Range through so seeking works. */
media.get('/stream/:id', async (c) => {
  const row = await c.env.DB.prepare("SELECT path, size FROM tracks WHERE id = ? AND status = 'ready' AND visible = 1")
    .bind(Number(c.req.param('id')))
    .first<{ path: string; size: number }>();
  if (!row) throw new HTTPException(404, { message: '找不到這首歌' });

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

/** Album art stored in D1; ids are content hashes so they can be cached forever. */
media.get('/art/:id', async (c) => {
  const id = c.req.param('id');
  if (c.req.header('if-none-match') === `"${id}"`) return new Response(null, { status: 304 });
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
  return new Response(data, {
    headers: {
      'Content-Type': mime,
      'Cache-Control': 'public, max-age=31536000, immutable',
      ETag: `"${id}"`,
    },
  });
});

export default media;
