import { useEffect, useLayoutEffect, useState, type FormEvent } from 'react';
import { Link, Navigate, useLocation } from 'react-router-dom';
import { api } from '../api/client';
import { useSession } from '../store/session';
import { IconWave } from './Icons';

/** Where to return after logging in, as set by requireLogin() or RequireUser. */
function loginReturnPath(state: unknown) {
  const from = (state as { from?: unknown } | null)?.from;
  return typeof from === 'string' && from.startsWith('/') && !from.startsWith('/login') ? from : '/discover';
}

/** Loads the session once; pages stay browsable while signed out. */
export function AuthGate({ children }: { children: React.ReactNode }) {
  const location = useLocation();
  const ready = useSession((s) => s.ready);
  const needsSetup = useSession((s) => s.needsSetup);
  const init = useSession((s) => s.init);

  useEffect(() => { void init(); }, [init]);

  if (!ready) {
    return <div className="app-loading" aria-live="polite"><span className="brand-pulse"><IconWave size={28} /></span><p>載入你的音樂庫…</p></div>;
  }
  if (needsSetup && location.pathname !== '/login') return <Navigate to="/login" replace />;
  return children;
}

/** Sends signed-out visitors to the login page and brings them back afterwards. */
export function RequireUser({ children }: { children: React.ReactNode }) {
  const location = useLocation();
  const user = useSession((s) => s.user);
  if (user) return children;
  return <Navigate to="/login" replace state={{ from: location.pathname + location.search + location.hash }} />;
}

export function LoginPage() {
  const location = useLocation();
  const needsSetup = useSession((s) => s.needsSetup);
  const user = useSession((s) => s.user);
  const setUser = useSession((s) => s.setUser);
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');

  // The shell's scroll restoration doesn't cover this page, so start at the top
  // even when the visitor was sent here from far down a long list.
  useLayoutEffect(() => {
    window.scrollTo({ top: 0, left: 0, behavior: 'instant' });
  }, []);

  useEffect(() => {
    document.title = needsSetup ? 'Ascooo Music' : '登入 · Ascooo Music';
  }, [needsSetup]);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setPending(true);
    setError('');
    try {
      const result = needsSetup ? await api.auth.setup(username, password) : await api.auth.login(username, password);
      setUsername('');
      setPassword('');
      setUser(result.user);
    } catch (caught) {
      setError((caught as Error).message);
    } finally {
      setPending(false);
    }
  }

  if (user) return <Navigate to={loginReturnPath(location.state)} replace />;

  return (
    <main className="auth-page">
      <div className="auth-page__wash" aria-hidden="true" />
      <section className="auth-intro">
        <div className="brand brand--large"><img className="brand__image" src="/brand-logo/ascooo-musis.png" width="750" height="320" alt="Ascooo Music" draggable={false} /></div>
        <div className="auth-intro__copy">
          <h1>歡迎<br /><em>登入後收聽</em></h1>
        </div>
        <div className="signal-line signal-line--wide" aria-hidden="true"><i /><i /><i /><i /><i /><i /><i /><i /><i /><i /><i /><i /></div>
      </section>
      <section className="auth-card" aria-labelledby={needsSetup ? 'auth-title' : undefined} aria-label={needsSetup ? undefined : '登入'}>
        {needsSetup ? <><span className="auth-card__number">00 / SETUP</span><h2 id="auth-title">建立管理員帳號</h2><p>第一次使用，只需要完成這個步驟。</p></> : null}
        <form onSubmit={submit}>
          <label><span>帳號</span><input autoComplete="username" value={username} onChange={(event) => setUsername(event.target.value)} placeholder="輸入帳號" minLength={2} required /></label>
          <label><span>密碼</span><input type="password" autoComplete={needsSetup ? 'new-password' : 'current-password'} value={password} onChange={(event) => setPassword(event.target.value)} placeholder="至少 8 個字元" minLength={8} required /></label>
          {error ? <div className="form-error" role="alert">{error}</div> : null}
          <button className="primary-button" type="submit" disabled={pending}>{pending ? '處理中…' : needsSetup ? '建立並開始使用' : '登入'}</button>
        </form>
        {needsSetup ? null : <Link className="auth-card__browse" to="/discover">先不登入，繼續瀏覽</Link>}
      </section>
    </main>
  );
}
