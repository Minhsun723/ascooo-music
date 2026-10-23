import { Hono } from 'hono';
import { HTTPException } from 'hono/http-exception';
import { logger } from 'hono/logger';
import type { AppEnv } from './env';
import { loadUser, requireUser } from './lib/auth';
import auth from './routes/auth';
import library, { catalog } from './routes/library';
import me from './routes/me';
import media, { artwork } from './routes/media';
import sync from './routes/sync';

const app = new Hono<AppEnv>().basePath('/api');

app.use('*', logger());

// API responses are data, never pages: opened directly (a cover, an audio file,
// JSON), the browser must not sniff them into HTML or run scripts inside them.
app.use('*', async (c, next) => {
  await next();
  // Responses from fetch() and the Cache API have immutable headers.
  c.res = new Response(c.res.body, c.res);
  c.res.headers.set('X-Content-Type-Options', 'nosniff');
  c.res.headers.set('Content-Security-Policy', "default-src 'none'; style-src 'unsafe-inline'; sandbox; frame-ancestors 'none'");
});

app.get('/health', (c) => c.json({ ok: true }));
app.route('/auth', auth);
app.route('/', artwork);

// Browsing is public. Signed-out visitors read the catalog through the edge cache,
// while playback, lyrics and personal data below still require a session.
app.use('*', loadUser);
app.route('/', catalog);

// Everything below requires a signed-in user.
app.use('*', requireUser);
app.route('/', library);
app.route('/me', me);
app.route('/', media);
app.route('/sync', sync);

app.notFound((c) => c.json({ error: '找不到這個 API' }, 404));

app.onError((err, c) => {
  if (err instanceof HTTPException) return c.json({ error: err.message }, err.status);
  console.error(err);
  return c.json({ error: err.message || '伺服器發生錯誤' }, 500);
});

export default app;
