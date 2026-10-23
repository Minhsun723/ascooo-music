import type { Context, MiddlewareHandler } from 'hono';
import { deleteCookie, getCookie, setCookie } from 'hono/cookie';
import { HTTPException } from 'hono/http-exception';
import { sign, verify } from 'hono/jwt';
import type { AppEnv, SessionUser } from '../env';

const COOKIE = 'am_session';
const SESSION_DAYS = 30;
// A session is trusted on its signature alone for this long; after that D1
// confirms the account still exists and the session was not revoked.
const RECHECK_SECONDS = 60 * 60;
// Workers caps PBKDF2 at 100k iterations; 60k keeps login well under CPU limits.
const ITERATIONS = 60000;

const b64 = (buf: ArrayBuffer | Uint8Array) => btoa(String.fromCharCode(...new Uint8Array(buf)));
const unb64 = (s: string) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

async function derive(password: string, salt: Uint8Array, iterations: number): Promise<ArrayBuffer> {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveBits']);
  return crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations }, key, 256);
}

export async function hashPassword(password: string): Promise<string> {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const hash = await derive(password, salt, ITERATIONS);
  return `pbkdf2$${ITERATIONS}$${b64(salt)}$${b64(hash)}`;
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [scheme, iter, salt, hash] = stored.split('$');
  if (scheme !== 'pbkdf2') return false;
  const actual = new Uint8Array(await derive(password, unb64(salt), Number(iter)));
  const expected = unb64(hash);
  if (actual.length !== expected.length) return false;
  let diff = 0;
  for (let i = 0; i < actual.length; i++) diff |= actual[i] ^ expected[i];
  return diff === 0;
}

// Unknown usernames are checked against this, so a failed login costs the same
// PBKDF2 work whether or not the account exists.
const MISSING_USER_HASH = `pbkdf2$${ITERATIONS}$${b64(new Uint8Array(16))}$${b64(new Uint8Array(32))}`;

/** Verify a login without revealing through response time whether the username exists. */
export async function verifyLogin(password: string, stored: string | undefined): Promise<boolean> {
  const valid = await verifyPassword(password, stored ?? MISSING_USER_HASH);
  return valid && stored !== undefined;
}

/**
 * `version` is the user's session_version. The hourly re-check passes the
 * original `exp`, so renewing a session never extends its lifetime.
 */
export async function startSession(
  c: Context<AppEnv>,
  user: SessionUser,
  version: number,
  exp = Math.floor(Date.now() / 1000) + SESSION_DAYS * 86400,
) {
  const iat = Math.floor(Date.now() / 1000);
  const token = await sign(
    { sub: user.id, name: user.username, role: user.role, ver: version, iat, exp },
    c.env.JWT_SECRET,
    'HS256',
  );
  setCookie(c, COOKIE, token, {
    httpOnly: true,
    secure: new URL(c.req.url).protocol === 'https:',
    sameSite: 'Lax',
    path: '/',
    maxAge: exp - iat,
  });
}

export function endSession(c: Context<AppEnv>) {
  deleteCookie(c, COOKIE, { path: '/' });
}

/** Drop a cookie that no longer grants a session, so later requests skip the D1 re-check. */
export function clearStaleSession(c: Context<AppEnv>) {
  if (getCookie(c, COOKIE)) endSession(c);
}

export async function readSession(c: Context<AppEnv>): Promise<SessionUser | null> {
  const token = getCookie(c, COOKIE);
  if (!token) return null;
  let p: Awaited<ReturnType<typeof verify>>;
  try {
    p = await verify(token, c.env.JWT_SECRET, 'HS256');
  } catch {
    return null;
  }
  const id = Number(p.sub);
  if (typeof p.iat === 'number' && Math.floor(Date.now() / 1000) - p.iat < RECHECK_SECONDS) {
    return { id, username: String(p.name), role: p.role === 'admin' ? 'admin' : 'user' };
  }

  // Tokens issued before session_version existed carry no `ver` and match the column default.
  const row = await c.env.DB.prepare('SELECT username, role, session_version FROM users WHERE id = ?')
    .bind(id)
    .first<{ username: string; role: string; session_version: number }>();
  if (!row || row.session_version !== Number(p.ver ?? 0)) return null;
  const user: SessionUser = { id, username: row.username, role: row.role === 'admin' ? 'admin' : 'user' };
  await startSession(c, user, row.session_version, Number(p.exp));
  return user;
}

/** Attach the signed-in user when there is one; signed-out requests continue as anonymous. */
export const loadUser: MiddlewareHandler<AppEnv> = async (c, next) => {
  const user = await readSession(c);
  if (user) c.set('user', user);
  await next();
};

export const requireUser: MiddlewareHandler<AppEnv> = async (c, next) => {
  const user = c.get('user') ?? (await readSession(c));
  if (!user) {
    clearStaleSession(c);
    throw new HTTPException(401, { message: '請先登入' });
  }
  c.set('user', user);
  await next();
};

/** Trust the admin role in the signed session without a D1 lookup; readSession re-confirms it hourly. */
export const requireSessionAdmin: MiddlewareHandler<AppEnv> = async (c, next) => {
  if (c.get('user')?.role !== 'admin') throw new HTTPException(403, { message: '需要管理員權限' });
  await next();
};

export const requireAdmin: MiddlewareHandler<AppEnv> = async (c, next) => {
  const sessionUser = c.get('user');
  if (sessionUser?.role !== 'admin') throw new HTTPException(403, { message: '需要管理員權限' });
  const admin = await c.env.DB.prepare("SELECT id FROM users WHERE id = ? AND role = 'admin'")
    .bind(sessionUser.id)
    .first<{ id: number }>();
  if (!admin) throw new HTTPException(403, { message: '管理員權限已失效，請重新登入' });
  await next();
};
