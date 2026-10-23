import { Hono } from 'hono';
import { HTTPException } from 'hono/http-exception';
import type { AppEnv, SessionUser } from '../env';
import {
  clearStaleSession,
  endSession,
  hashPassword,
  readSession,
  requireAdmin,
  requireUser,
  startSession,
  verifyLogin,
  verifyPassword,
} from '../lib/auth';

const auth = new Hono<AppEnv>();

async function userCount(db: D1Database) {
  const r = await db.prepare('SELECT COUNT(*) AS n FROM users').first<{ n: number }>();
  return r?.n ?? 0;
}

function validate(body: { username?: string; password?: string }) {
  const username = String(body.username ?? '').trim();
  const password = String(body.password ?? '');
  if (!/^[\w.\-@]{2,32}$/.test(username)) throw new HTTPException(400, { message: '使用者名稱需為 2–32 個英數字元' });
  if (password.length < 8) throw new HTTPException(400, { message: '密碼至少需要 8 個字元' });
  return { username, password };
}

// Accounts can't drop back to zero (nobody can delete themselves), so once an
// isolate has seen a user it never needs to count again.
let setupComplete = false;

auth.get('/status', async (c) => {
  const user = await readSession(c);
  if (!user) clearStaleSession(c);
  if (!setupComplete) setupComplete = Boolean(user) || (await userCount(c.env.DB)) > 0;
  return c.json({ needsSetup: !setupComplete, user });
});

/** First-run: create the admin account. Disabled once any user exists. */
auth.post('/setup', async (c) => {
  if ((await userCount(c.env.DB)) > 0) throw new HTTPException(409, { message: '系統已完成初始化' });
  const { username, password } = validate(await c.req.json());
  const hash = await hashPassword(password);
  const r = await c.env.DB.prepare(
    "INSERT INTO users (username, password_hash, role, created_at) VALUES (?, ?, 'admin', ?) RETURNING id",
  )
    .bind(username, hash, Date.now())
    .first<{ id: number }>();
  const user: SessionUser = { id: r!.id, username, role: 'admin' };
  setupComplete = true;
  await startSession(c, user, 0);
  return c.json({ user });
});

auth.post('/login', async (c) => {
  // Throttle per IP before spending a D1 read and PBKDF2 work on the attempt.
  const { success } = await c.env.LOGIN_LIMITER.limit({ key: c.req.header('cf-connecting-ip') ?? 'unknown' });
  if (!success) {
    return c.json({ error: '登入嘗試次數過多，請稍後再試' }, 429, { 'Retry-After': '60' });
  }
  const body = await c.req.json<{ username?: string; password?: string }>();
  const row = await c.env.DB.prepare(
    'SELECT id, username, password_hash, role, session_version FROM users WHERE username = ?',
  )
    .bind(String(body.username ?? '').trim())
    .first<{ id: number; username: string; password_hash: string; role: 'admin' | 'user'; session_version: number }>();
  const valid = await verifyLogin(String(body.password ?? ''), row?.password_hash);
  if (!row || !valid) throw new HTTPException(401, { message: '帳號或密碼錯誤' });
  const user: SessionUser = { id: row.id, username: row.username, role: row.role };
  await startSession(c, user, row.session_version);
  return c.json({ user });
});

auth.post('/logout', (c) => {
  endSession(c);
  return c.json({ ok: true });
});

// ----- user management (admin) -----

auth.get('/users', requireUser, requireAdmin, async (c) => {
  const { results } = await c.env.DB.prepare('SELECT id, username, role, created_at FROM users ORDER BY id').all();
  return c.json({ users: results });
});

auth.post('/users', requireUser, requireAdmin, async (c) => {
  const body = await c.req.json<{ username?: string; password?: string; role?: string }>();
  const { username, password } = validate(body);
  const role = body.role === 'admin' ? 'admin' : 'user';
  try {
    await c.env.DB.prepare('INSERT INTO users (username, password_hash, role, created_at) VALUES (?, ?, ?, ?)')
      .bind(username, await hashPassword(password), role, Date.now())
      .run();
  } catch {
    throw new HTTPException(409, { message: '此使用者名稱已被使用' });
  }
  return c.json({ ok: true });
});

auth.delete('/users/:id', requireUser, requireAdmin, async (c) => {
  const id = Number(c.req.param('id'));
  if (id === c.get('user').id) throw new HTTPException(400, { message: '無法刪除目前登入的帳號' });
  await c.env.DB.prepare('DELETE FROM users WHERE id = ?').bind(id).run();
  return c.json({ ok: true });
});

auth.post('/password', requireUser, async (c) => {
  const body = await c.req.json<{ current?: string; next?: string }>();
  const row = await c.env.DB.prepare('SELECT password_hash FROM users WHERE id = ?')
    .bind(c.get('user').id)
    .first<{ password_hash: string }>();
  if (!row || !(await verifyPassword(String(body.current ?? ''), row.password_hash))) {
    throw new HTTPException(401, { message: '目前密碼不正確' });
  }
  if (String(body.next ?? '').length < 8) throw new HTTPException(400, { message: '新密碼至少需要 8 個字元' });
  const updated = await c.env.DB.prepare(
    `UPDATE users SET password_hash = ?, session_version = session_version + 1 WHERE id = ?
     RETURNING username, role, session_version`,
  )
    .bind(await hashPassword(String(body.next)), c.get('user').id)
    .first<{ username: string; role: 'admin' | 'user'; session_version: number }>();
  // Other devices fail their next hourly re-check; this one stays signed in.
  await startSession(
    c,
    { id: c.get('user').id, username: updated!.username, role: updated!.role },
    updated!.session_version,
  );
  return c.json({ ok: true });
});

export default auth;
