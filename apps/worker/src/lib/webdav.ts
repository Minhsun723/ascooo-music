import type { Env } from '../env';

export interface DavEntry {
  path: string; // decoded absolute path, e.g. /Music/Artist/Song.flac
  name: string;
  isDir: boolean;
  size: number;
  etag: string | null;
  mtime: number | null; // epoch ms
}

/**
 * PikPak answers file GETs with a 302 to a signed CDN URL. Following that
 * redirect costs a round-trip on every seek, so we keep resolved links for a
 * few minutes inside the isolate.
 */
const linkCache = new Map<string, { url: string; expires: number }>();
const LINK_TTL = 10 * 60 * 1000;

function tag(xml: string, name: string): string | null {
  const re = new RegExp(`<(?:[\\w-]+:)?${name}\\b[^>]*>([\\s\\S]*?)</(?:[\\w-]+:)?${name}>`, 'i');
  const m = xml.match(re);
  return m ? m[1] : null;
}

function decodeXml(s: string): string {
  return s
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&amp;/g, '&');
}

export function normalizePath(p: string): string {
  let out = ('/' + p).replace(/\/+/g, '/');
  if (out.length > 1 && out.endsWith('/')) out = out.slice(0, -1);
  return out;
}

export function parentDir(p: string): string {
  const i = p.lastIndexOf('/');
  return i <= 0 ? '/' : p.slice(0, i);
}

export class WebDAV {
  private base: URL;
  private authCandidates: string[];
  private preferredAuth = 0;

  constructor(env: Env) {
    const endpoint = env.WEBDAV_URL?.trim();
    if (!endpoint) throw new Error('缺少 WEBDAV_URL，請填入 PikPak 顯示的統一接入點');
    this.base = new URL(endpoint);
    const mode = env.WEBDAV_AUTH_MODE ?? 'auto';
    const username = env.WEBDAV_USERNAME?.trim();
    const password = env.WEBDAV_PASSWORD ?? '';
    const token = env.WEBDAV_BEARER_TOKEN?.trim().replace(/^Bearer\s+/i, '');
    const basic = username && password
      ? 'Basic ' + btoa(unescape(encodeURIComponent(`${username}:${password}`)))
      : null;
    const bearer = token ? `Bearer ${token}` : null;

    this.authCandidates = mode === 'basic'
      ? basic ? [basic] : []
      : mode === 'bearer'
        ? bearer ? [bearer] : []
        : [basic, bearer].filter((value): value is string => !!value);

    if (!this.authCandidates.length) {
      throw new Error(
        mode === 'bearer'
          ? '缺少 WEBDAV_BEARER_TOKEN'
          : mode === 'basic'
            ? '缺少 WEBDAV_USERNAME 或 WEBDAV_PASSWORD'
            : '請設定 WebDAV 帳密或 Bearer Token',
      );
    }
  }

  /**
   * WebDAV has one Authorization header. In auto mode, try Basic first and
   * retry with Bearer only after a 401. Never call this for a signed CDN URL.
   */
  private async fetchWithAuth(url: string, init: RequestInit): Promise<Response> {
    const order = [
      this.preferredAuth,
      ...this.authCandidates.map((_, index) => index).filter((index) => index !== this.preferredAuth),
    ];
    let last: Response | null = null;

    for (const index of order) {
      const headers = new Headers(init.headers);
      headers.set('Authorization', this.authCandidates[index]);
      const response = await fetch(url, { ...init, headers });
      last = response;
      if (response.status !== 401) {
        this.preferredAuth = index;
        return response;
      }
      await response.body?.cancel().catch(() => {});
    }
    return last!;
  }

  url(path: string): string {
    const basePath = this.base.pathname.replace(/\/$/, '');
    const encoded = normalizePath(path)
      .split('/')
      .map((seg) => encodeURIComponent(seg))
      .join('/');
    return `${this.base.origin}${basePath}${encoded}`;
  }

  async list(dir: string): Promise<DavEntry[]> {
    const target = normalizePath(dir);
    const res = await this.fetchWithAuth(this.url(target) + (target === '/' ? '' : '/'), {
      method: 'PROPFIND',
      headers: {
        Depth: '1',
        'Content-Type': 'application/xml; charset=utf-8',
      },
      body:
        '<?xml version="1.0" encoding="utf-8"?><d:propfind xmlns:d="DAV:"><d:prop>' +
        '<d:resourcetype/><d:getcontentlength/><d:getetag/><d:getlastmodified/>' +
        '</d:prop></d:propfind>',
    });
    if (res.status === 401) throw new Error('WebDAV 驗證失敗，請檢查 PikPak 接入點、帳密或 Bearer Token');
    if (res.status !== 207) throw new Error(`WebDAV PROPFIND ${target} 失敗：HTTP ${res.status}`);

    const xml = await res.text();
    const basePath = this.base.pathname.replace(/\/$/, '');
    const blocks = xml.match(/<(?:[\w-]+:)?response\b[\s\S]*?<\/(?:[\w-]+:)?response>/gi) ?? [];
    const entries: DavEntry[] = [];

    for (const block of blocks) {
      const hrefRaw = tag(block, 'href');
      if (!hrefRaw) continue;
      let href = decodeXml(hrefRaw.trim());
      if (/^https?:\/\//i.test(href)) href = new URL(href).pathname;
      let path: string;
      try {
        path = decodeURIComponent(href);
      } catch {
        path = href;
      }
      if (basePath && path.startsWith(basePath)) path = path.slice(basePath.length);
      path = normalizePath(path);
      if (path === target) continue;

      const resType = tag(block, 'resourcetype') ?? '';
      const isDir = /<(?:[\w-]+:)?collection\b/i.test(resType);
      const lastMod = tag(block, 'getlastmodified');
      const etag = tag(block, 'getetag');
      entries.push({
        path,
        name: path.slice(path.lastIndexOf('/') + 1),
        isDir,
        size: Number(tag(block, 'getcontentlength') ?? 0) || 0,
        etag: etag ? decodeXml(etag).replace(/"/g, '') : null,
        mtime: lastMod ? Date.parse(decodeXml(lastMod)) || null : null,
      });
    }
    return entries;
  }

  /** GET a file, following PikPak's CDN redirect and forwarding Range headers. */
  async fetchFile(path: string, init: { range?: string | null; ifRange?: string | null } = {}): Promise<Response> {
    const key = normalizePath(path);
    const headers: Record<string, string> = {};
    if (init.range) headers.Range = init.range;

    const cached = linkCache.get(key);
    if (cached && cached.expires > Date.now()) {
      const res = await fetch(cached.url, { headers, redirect: 'manual' });
      if (res.ok || res.status === 206 || res.status === 416) return res;
      linkCache.delete(key);
    }

    let url = this.url(key);
    let res = await this.fetchWithAuth(url, { headers, redirect: 'manual' });

    for (let hop = 0; hop < 5 && res.status >= 300 && res.status < 400; hop++) {
      const loc = res.headers.get('location');
      if (!loc) break;
      const next = new URL(loc, url);
      const sameOrigin = next.origin === this.base.origin;
      url = next.toString();
      res = sameOrigin
        ? await this.fetchWithAuth(url, { headers, redirect: 'manual' })
        : await fetch(url, { headers, redirect: 'manual' });
      if (!sameOrigin && (res.ok || res.status === 206)) {
        linkCache.set(key, { url, expires: Date.now() + LINK_TTL });
      }
    }
    return res;
  }

  /** Read an exact byte range into memory (used by the tag parser). */
  async readRange(path: string, start: number, end: number): Promise<Uint8Array> {
    const res = await this.fetchFile(path, { range: `bytes=${start}-${end}` });
    if (res.status === 416) return new Uint8Array(0);
    if (!res.ok && res.status !== 206) throw new Error(`讀取 ${path} 失敗：HTTP ${res.status}`);
    if (res.status === 200) {
      // Server ignored Range: read only what we need, then cancel.
      const reader = res.body!.getReader();
      const want = end - start + 1;
      const out = new Uint8Array(want);
      let pos = 0;
      let skipped = 0;
      while (pos < want) {
        const { value, done } = await reader.read();
        if (done) break;
        let chunk = value;
        if (skipped < start) {
          const drop = Math.min(start - skipped, chunk.length);
          skipped += drop;
          chunk = chunk.subarray(drop);
        }
        const take = Math.min(chunk.length, want - pos);
        out.set(chunk.subarray(0, take), pos);
        pos += take;
      }
      reader.cancel().catch(() => {});
      return out.subarray(0, pos);
    }
    return new Uint8Array(await res.arrayBuffer());
  }

  async readText(path: string): Promise<string> {
    const res = await this.fetchFile(path);
    if (!res.ok) throw new Error(`讀取 ${path} 失敗：HTTP ${res.status}`);
    const buf = new Uint8Array(await res.arrayBuffer());
    return decodeTextFile(buf);
  }
}

/** Decode a text file that might be UTF-8 (with/without BOM) or UTF-16. */
export function decodeTextFile(buf: Uint8Array): string {
  if (buf[0] === 0xff && buf[1] === 0xfe) return new TextDecoder('utf-16le').decode(buf.subarray(2));
  if (buf[0] === 0xfe && buf[1] === 0xff) {
    const swapped = new Uint8Array(buf.length - 2);
    for (let i = 2; i + 1 < buf.length; i += 2) {
      swapped[i - 2] = buf[i + 1];
      swapped[i - 1] = buf[i];
    }
    return new TextDecoder('utf-16le').decode(swapped);
  }
  const start = buf[0] === 0xef && buf[1] === 0xbb && buf[2] === 0xbf ? 3 : 0;
  return new TextDecoder('utf-8').decode(buf.subarray(start));
}
