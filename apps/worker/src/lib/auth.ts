import type { Context, MiddlewareHandler } from 'hono';
import { deleteCookie, getCookie, setCookie } from 'hono/cookie';
import { HTTPException } from 'hono/http-exception';
import { sign, verify } from 'hono/jwt';
import type { AppEnv, SessionUser } from '../env';

const COOKIE = 'am_session';
const SESSION_DAYS = 30;
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

export async function startSession(c: Context<AppEnv>, user: SessionUser) {
  const exp = Math.floor(Date.now() / 1000) + SESSION_DAYS * 86400;
  const token = await sign({ sub: user.id, name: user.username, role: user.role, exp }, c.env.JWT_SECRET, 'HS256');
  setCookie(c, COOKIE, token, {
    httpOnly: true,
    secure: new URL(c.req.url).protocol === 'https:',
    sameSite: 'Lax',
    path: '/',
    maxAge: SESSION_DAYS * 86400,
  });
}

export function endSession(c: Context<AppEnv>) {
  deleteCookie(c, COOKIE, { path: '/' });
}

export async function readSession(c: Context<AppEnv>): Promise<SessionUser | null> {
  const token = getCookie(c, COOKIE);
  if (!token) return null;
  try {
    const p = await verify(token, c.env.JWT_SECRET, 'HS256');
    return { id: Number(p.sub), username: String(p.name), role: p.role === 'admin' ? 'admin' : 'user' };
  } catch {
    return null;
  }
}

export const requireUser: MiddlewareHandler<AppEnv> = async (c, next) => {
  const user = await readSession(c);
  if (!user) throw new HTTPException(401, { message: '請先登入' });
  c.set('user', user);
  await next();
};

/** Trust the admin role in the signed session without performing a D1 lookup. */
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
