import { useEffect, useLayoutEffect, useState, type CSSProperties } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { artUrl } from '../api/client';
import { DEFAULT_PALETTE, extractPalette } from '../lib/color';
import { useLoginPrompt } from '../store/loginPrompt';
import { useSession } from '../store/session';
import { Artwork } from './Artwork';

/** Asks signed-out visitors to sign in before playing, instead of yanking them to the login page. */
export function LoginPromptDialog() {
  const prompt = useLoginPrompt((s) => s.prompt);
  const close = useLoginPrompt((s) => s.close);
  const signedIn = useSession((s) => Boolean(s.user));
  const location = useLocation();
  const navigate = useNavigate();
  const track = prompt?.track;
  const src = artUrl(track?.artworkId);
  const [glow, setGlow] = useState(DEFAULT_PALETTE.glow);

  useEffect(() => { close(); }, [close, location.pathname, signedIn]);

  useEffect(() => {
    if (!src) return setGlow(DEFAULT_PALETTE.glow);
    let live = true;
    void extractPalette(src).then((palette) => { if (live) setGlow(palette.glow); });
    return () => { live = false; };
  }, [src]);

  // Same page lock as now-playing: the backdrop shouldn't let the list behind it scroll.
  useLayoutEffect(() => {
    if (!prompt) return;
    const body = document.body;
    const scrollbarWidth = Math.max(0, window.innerWidth - document.documentElement.clientWidth);
    body.style.setProperty('--scrollbar-compensation', `${scrollbarWidth}px`);
    body.classList.add('overlay-open');
    return () => {
      body.classList.remove('overlay-open');
      body.style.removeProperty('--scrollbar-compensation');
    };
  }, [prompt]);

  useEffect(() => {
    if (!prompt) return;
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') close(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [close, prompt]);

  if (!prompt) return null;

  const login = () => {
    close();
    navigate('/login', { state: { from: location.pathname + location.search + location.hash } });
  };
  const style = { '--prompt-glow': glow } as CSSProperties;

  return (
    <div className="dialog-backdrop login-prompt-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) close(); }}>
      <div className="login-prompt-stack" onMouseDown={(event) => { if (event.target === event.currentTarget) close(); }}>
        <section className={`login-prompt${track ? '' : ' login-prompt--plain'}`} style={style} role="dialog" aria-modal="true" aria-labelledby="login-prompt-title">
          {track
            ? <Artwork artworkId={track.artworkId} title={track.title} artist={track.artist} className="login-prompt__art" loading="eager" />
            : <img className="login-prompt__brand" src="/brand-logo/ascooo-musis.png" width="750" height="320" alt="Ascooo Music" draggable={false} />}
          <div className="login-prompt__body">
            <h2 id="login-prompt-title">{prompt.title ?? '登入 Ascooo Music 開始收聽'}</h2>
            {track ? <p className="login-prompt__track">{track.title}<span aria-hidden="true"> · </span>{track.artist}</p> : null}
            <button type="button" className="primary-button" autoFocus onClick={login}>登入</button>
          </div>
        </section>
        <button type="button" className="login-prompt__close" onClick={close}>關閉</button>
      </div>
    </div>
  );
}
