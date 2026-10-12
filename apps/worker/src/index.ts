import { Hono } from 'hono';
import { HTTPException } from 'hono/http-exception';
import { logger } from 'hono/logger';
import type { AppEnv } from './env';
import { requireUser } from './lib/auth';
import auth from './routes/auth';
import library from './routes/library';
import me from './routes/me';
import media from './routes/media';
import sync from './routes/sync';

const app = new Hono<AppEnv>().basePath('/api');

app.use('*', logger());

app.get('/health', (c) => c.json({ ok: true }));
app.route('/auth', auth);

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
