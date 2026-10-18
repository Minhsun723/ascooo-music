import type { MiddlewareHandler } from 'hono';
import type { AppEnv } from '../env';

/** How long a colo keeps an anonymous catalog response before asking D1 again. */
const ANONYMOUS_TTL_SECONDS = 600;
/** Only these query parameters change catalog output; anything else must not split the cache. */
const KEY_PARAMS = ['q', 'sort', 'limit', 'offset'];

function cacheKey(url: string) {
  const source = new URL(url);
  const key = new URL(source.pathname, source.origin);
  for (const name of KEY_PARAMS) {
    const value = source.searchParams.get(name);
    if (value !== null) key.searchParams.set(name, name === 'q' ? value.trim() : value);
  }
  key.searchParams.set('viewer', 'anonymous');
  return new Request(key.toString(), { method: 'GET' });
}

/**
 * Signed-out visitors all receive the same catalog JSON, so serve it from the
 * colo cache and only reach D1 on a miss. Signed-in requests skip the cache
 * because their rows carry per-user likes and play history.
 */
export const anonymousEdgeCache: MiddlewareHandler<AppEnv> = async (c, next) => {
  if (c.get('user')) return next();

  const key = cacheKey(c.req.url);
  const cache = caches.default;
  const cached = await cache.match(key);
  if (cached) {
    // The stored copy is public for the edge only; the browser must not reuse it after login.
    const response = new Response(cached.body, cached);
    response.headers.set('Cache-Control', 'no-store');
    return response;
  }

  // Only misses cost D1 reads, so only misses count against the per-IP budget.
  const ip = c.req.header('cf-connecting-ip') ?? 'unknown';
  const { success } = await c.env.ANONYMOUS_LIMITER.limit({ key: ip });
  if (!success) {
    return c.json({ error: '請求過於頻繁，請稍後再試或登入後繼續瀏覽' }, 429, { 'Retry-After': '60', 'Cache-Control': 'no-store' });
  }

  await next();
  if (c.res.status !== 200) return;
  const copy = c.res.clone();
  const stored = new Response(copy.body, { status: 200, headers: copy.headers });
  stored.headers.set('Cache-Control', `public, max-age=${ANONYMOUS_TTL_SECONDS}`);
  c.executionCtx.waitUntil(cache.put(key, stored));
  c.res.headers.set('Cache-Control', 'no-store');
};
