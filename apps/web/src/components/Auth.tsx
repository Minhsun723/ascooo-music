import { useEffect, useState, type FormEvent } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { api } from '../api/client';
import { useSession } from '../store/session';
import { IconWave } from './Icons';

export function AuthGate({ children }: { children: React.ReactNode }) {
  const location = useLocation();
  const navigate = useNavigate();
  const ready = useSession((s) => s.ready);
  const needsSetup = useSession((s) => s.needsSetup);
  const user = useSession((s) => s.user);
  const init = useSession((s) => s.init);
  const setUser = useSession((s) => s.setUser);
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => { void init(); }, [init]);

  useEffect(() => {
    if (user) return;
    setUsername('');
    setPassword('');
    setPending(false);
    setError('');
  }, [user]);

  useEffect(() => {
    if (!ready || user) return;
    document.title = 'Ascooo Music';
    if (location.pathname !== '/' || location.search || location.hash) {
      navigate('/', { replace: true });
    }
  }, [location.hash, location.pathname, location.search, navigate, ready, user]);

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

  if (!ready) {
    return <div className="app-loading" aria-live="polite"><span className="brand-pulse"><IconWave size={28} /></span><p>載入你的音樂庫…</p></div>;
  }
  if (user) return children;

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
      </section>
    </main>
  );
}
