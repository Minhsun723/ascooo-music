import { useEffect, useLayoutEffect, useState, type FormEvent } from 'react';
import { Link, Navigate, useLocation } from 'react-router-dom';
import { api } from '../api/client';
import { useSession } from '../store/session';

const LOGO_HEADBAND = 'M 62.105469 324.574219 C 80.558594 285.308594 110.953125 258.144531 141.832031 235.234375 C 134.496094 205.394531 126.621094 177.476562 121.140625 149.097656 C 118.875 137.355469 120.117188 124.289062 122.558594 112.394531 C 131.714844 67.734375 173.910156 46.476562 216.019531 64.394531 C 236.4375 73.082031 251.570312 87.925781 261.886719 106.980469 C 272.429688 126.457031 281.496094 146.773438 290.390625 167.078125 C 293.425781 174.007812 296.207031 175.878906 304.335938 175.746094 C 353.617188 174.945312 402.921875 175.347656 453.703125 175.347656 C 458.453125 163.414062 463.460938 150.109375 469.027344 137.039062 C 478.804688 114.074219 491.265625 92.800781 511.386719 77.234375 C 535.351562 58.695312 561.953125 51.953125 590.484375 64.691406 C 618.863281 77.363281 630.082031 103.152344 628.1875 131.441406 C 626.332031 159.074219 617.558594 186.265625 611.449219 213.566406 C 610.183594 219.222656 607.28125 224.515625 604.746094 230.957031 C 666.246094 275.617188 703.527344 334.0625 708.425781 413.917969 C 636.761719 279.640625 523.136719 218.265625 377.535156 217.339844 C 232.28125 216.417969 119.289062 279.238281 41.835938 406.964844 C 44.070312 377.234375 50.003906 350.753906 62.105469 324.574219 M 179.828125 195.019531 C 181.929688 199.820312 184.03125 204.625 186.027344 209.183594 C 206.5625 201.445312 226.246094 194.027344 247.109375 186.164062 C 239.199219 159.117188 229.589844 132.667969 207.945312 113.523438 C 201.328125 107.667969 188.292969 103.710938 180.488281 106.167969 C 173.679688 108.308594 169.039062 120.253906 165.496094 128.730469 C 163.429688 133.671875 164.363281 140.5625 165.753906 146.125 C 169.679688 161.832031 174.542969 177.304688 179.828125 195.019531 M 516.476562 145.90625 C 511.226562 158.898438 505.976562 171.890625 500.769531 184.777344 C 523.109375 192.8125 543.191406 200.039062 564.003906 207.523438 C 573.8125 181.925781 585.839844 157.121094 582.222656 129.21875 C 581.164062 121.078125 575.765625 109.566406 569.421875 107.082031 C 562.035156 104.1875 549.089844 106.667969 542.761719 111.902344 C 532.496094 120.382812 525.660156 133.011719 516.476562 145.90625 Z';
const LOGO_BAR_CENTER_Y = 516.455;
// Left edge plus heights per bar; each loop starts and ends on the logo's own resting heights.
const LOGO_BARS = [
  { x: 135.078, heights: [137.54, 260, 90, 137.54] },
  { x: 226.848, heights: [366.79, 180, 320, 366.79] },
  { x: 318.613, heights: [91.7, 300, 150, 91.7] },
  { x: 410.379, heights: [275.09, 120, 340, 275.09] },
  { x: 502.145, heights: [366.79, 240, 140, 366.79] },
  { x: 593.91, heights: [137.54, 70, 230, 137.54] },
];

/** The headphone logo with its sound bars bouncing; SMIL keeps the rounded caps intact while the height changes. */
function LoadingLogo() {
  const still = typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
  const barY = (height: number) => (LOGO_BAR_CENTER_Y - height / 2).toFixed(2);
  return (
    <svg className="loading-logo" viewBox="30 48 690 664" fill="currentColor" aria-hidden="true">
      <path d={LOGO_HEADBAND} />
      <g>
        {LOGO_BARS.map(({ x, heights }) => (
          <rect key={x} x={x} y={barY(heights[0])} width="45.88" height={heights[0]} rx="22.94">
            {still ? null : <>
              <animate attributeName="height" dur="1.4s" repeatCount="indefinite" calcMode="spline" keyTimes="0;.33;.66;1" keySplines=".45 0 .55 1;.45 0 .55 1;.45 0 .55 1" values={heights.join(';')} />
              <animate attributeName="y" dur="1.4s" repeatCount="indefinite" calcMode="spline" keyTimes="0;.33;.66;1" keySplines=".45 0 .55 1;.45 0 .55 1;.45 0 .55 1" values={heights.map(barY).join(';')} />
            </>}
          </rect>
        ))}
      </g>
    </svg>
  );
}

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
    return <div className="app-loading" aria-live="polite"><LoadingLogo /><p>燈光暗下，音樂將起…</p></div>;
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
