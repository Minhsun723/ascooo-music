import { useEffect, useLayoutEffect, useRef, useState, type FormEvent } from 'react';
import { NavLink, Outlet, useLocation, useNavigate, useNavigationType } from 'react-router-dom';
import { api } from '../api/client';
import { usePlayer } from '../store/player';
import { useSession } from '../store/session';
import { toast } from '../store/toast';
import {
  IconChevronLeft,
  IconDisc,
  IconHeart,
  IconHome,
  IconLibrary,
  IconLogout,
  IconPlus,
  IconSearch,
  IconSettings,
  IconUser,
} from './Icons';
import { NowPlaying, PlayerBar, QueuePanel } from './Player';

const mainNav = [
  { to: '/', label: '首頁', icon: IconHome, end: true },
  { to: '/search', label: '搜尋', icon: IconSearch },
  { to: '/library', label: '音樂庫', icon: IconLibrary },
  { to: '/favorites', label: '喜愛的歌曲', icon: IconHeart },
];

const legalLinks = [
  { href: 'https://ascooo.com/privacy', label: '隱私權政策' },
  { href: 'https://ascooo.com/terms', label: '使用條款' },
];

function isInteractiveTarget(target: EventTarget | null) {
  return target instanceof Element && Boolean(target.closest('input, textarea, select, button, a, [contenteditable="true"], [role="button"], [role="textbox"]'));
}

function Brand() {
  return <NavLink to="/" className="brand" aria-label="Ascooo Music 首頁"><img className="brand__image" src="/brand-logo/ascooo-music_light.png" width="750" height="320" alt="" aria-hidden="true" draggable={false} /></NavLink>;
}

function SiteFooter() {
  return (
    <footer className="site-footer">
      <p className="site-footer__copyright">© {new Date().getFullYear()} Ascooo. All rights reserved.</p>
      <nav className="site-footer__links" aria-label="法律資訊">
        {legalLinks.map(({ href, label }) => (
          <a key={href} href={href} target="_blank" rel="noopener noreferrer">{label}</a>
        ))}
      </nav>
    </footer>
  );
}

function restoreScrollPosition(top: number) {
  let active = true;
  let frameId: number | undefined;
  let timeoutId: number | undefined;
  let observer: ResizeObserver | undefined;

  const stop = () => {
    if (!active) return;
    active = false;
    if (frameId !== undefined) window.cancelAnimationFrame(frameId);
    if (timeoutId !== undefined) window.clearTimeout(timeoutId);
    observer?.disconnect();
    window.removeEventListener('wheel', stop);
    window.removeEventListener('touchstart', stop);
    window.removeEventListener('pointerdown', stop);
    window.removeEventListener('keydown', stop);
  };

  const attempt = () => {
    if (!active) return;
    window.scrollTo({ top, left: 0, behavior: 'instant' });
    if (Math.abs(window.scrollY - top) <= 1) stop();
  };

  attempt();
  if (!active) return stop;

  observer = new ResizeObserver(() => {
    if (frameId !== undefined) window.cancelAnimationFrame(frameId);
    frameId = window.requestAnimationFrame(attempt);
  });
  observer.observe(document.body);
  const page = document.querySelector('.page');
  if (page) observer.observe(page);

  window.addEventListener('wheel', stop, { passive: true });
  window.addEventListener('touchstart', stop, { passive: true });
  window.addEventListener('pointerdown', stop, { passive: true });
  window.addEventListener('keydown', stop);
  timeoutId = window.setTimeout(stop, 10_000);

  return stop;
}

function CreatePlaylistDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [name, setName] = useState('');
  const [pending, setPending] = useState(false);
  const refresh = useSession((s) => s.refreshPlaylists);
  const navigate = useNavigate();

  useEffect(() => {
    if (!open) return;
    const closeOnEscape = (event: KeyboardEvent) => { if (event.key === 'Escape') onClose(); };
    window.addEventListener('keydown', closeOnEscape);
    return () => window.removeEventListener('keydown', closeOnEscape);
  }, [onClose, open]);

  if (!open) return null;

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!name.trim()) return;
    setPending(true);
    try {
      const playlist = await api.createPlaylist(name.trim());
      await refresh();
      onClose();
      setName('');
      navigate(`/playlist/${playlist.id}`);
      toast('播放清單已建立');
    } catch (error) {
      toast((error as Error).message, 'error');
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="dialog-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <section className="dialog" role="dialog" aria-modal="true" aria-labelledby="playlist-dialog-title">
        <span className="eyebrow">NEW PLAYLIST</span><h2 id="playlist-dialog-title">建立播放清單</h2>
        <form onSubmit={submit}><label><span>名稱</span><input autoFocus value={name} onChange={(event) => setName(event.target.value)} placeholder="例如：週日午後" maxLength={100} /></label><div className="dialog__actions"><button type="button" className="text-button" onClick={onClose}>取消</button><button type="submit" className="primary-button" disabled={!name.trim() || pending}>{pending ? '建立中…' : '建立'}</button></div></form>
      </section>
    </div>
  );
}

export function Shell() {
  const user = useSession((s) => s.user)!;
  const playlists = useSession((s) => s.playlists);
  const logout = useSession((s) => s.logout);
  const hasPlayer = usePlayer((s) => Boolean(s.queue[s.index]));
  const location = useLocation();
  const navigate = useNavigate();
  const navigationType = useNavigationType();
  const scrollPositions = useRef(new Map<string, number>());
  const activeLocationKey = useRef(location.key);
  const previousPathname = useRef<string | null>(null);
  const [query, setQuery] = useState(new URLSearchParams(location.search).get('q') ?? '');
  const [createOpen, setCreateOpen] = useState(false);
  const isHomePage = location.pathname === '/';
  const isSearchPage = location.pathname === '/search';
  const isRestoringHistory = navigationType === 'POP' && scrollPositions.current.has(location.key);

  useEffect(() => {
    if (location.pathname === '/search') setQuery(new URLSearchParams(location.search).get('q') ?? '');
  }, [location.pathname, location.search]);

  useEffect(() => {
    const previous = window.history.scrollRestoration;
    window.history.scrollRestoration = 'manual';
    return () => { window.history.scrollRestoration = previous; };
  }, []);

  useEffect(() => {
    const rememberPosition = () => {
      scrollPositions.current.set(activeLocationKey.current, window.scrollY);
    };
    rememberPosition();
    window.addEventListener('scroll', rememberPosition, { passive: true });
    return () => window.removeEventListener('scroll', rememberPosition);
  }, []);

  useLayoutEffect(() => {
    const pathnameChanged = previousPathname.current !== location.pathname;
    previousPathname.current = location.pathname;
    activeLocationKey.current = location.key;

    const shouldRestore = navigationType === 'POP' || pathnameChanged;
    const target = navigationType === 'POP'
      ? scrollPositions.current.get(location.key) ?? 0
      : 0;
    const cancelRestoration = shouldRestore ? restoreScrollPosition(target) : () => {};

    return cancelRestoration;
  }, [location.key, location.pathname, navigationType]);

  useEffect(() => {
    const focusSearch = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        document.querySelector<HTMLInputElement>('.global-search input')?.focus();
      }
    };
    window.addEventListener('keydown', focusSearch);
    return () => window.removeEventListener('keydown', focusSearch);
  }, []);

  useEffect(() => {
    const togglePlayback = (event: KeyboardEvent) => {
      if (
        event.code !== 'Space'
        || event.repeat
        || event.metaKey
        || event.ctrlKey
        || event.altKey
        || event.shiftKey
        || event.defaultPrevented
        || isInteractiveTarget(event.target)
      ) return;

      const player = usePlayer.getState();
      if (!player.queue[player.index]) return;
      event.preventDefault();
      player.toggle();
    };

    window.addEventListener('keydown', togglePlayback);
    return () => window.removeEventListener('keydown', togglePlayback);
  }, []);

  function search(event: FormEvent) {
    event.preventDefault();
    navigate(`/search${query.trim() ? `?q=${encodeURIComponent(query.trim())}` : ''}`);
  }

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <Brand />
        <nav className="sidebar__nav" aria-label="主要導覽">
          {mainNav.map(({ to, label, icon: Icon, end }) => <NavLink key={to} to={to} end={end} className={({ isActive }) => isActive ? 'is-active' : ''}><Icon size={20} /><span>{label}</span></NavLink>)}
        </nav>
        <div className="sidebar__section">
          <div className="sidebar__section-title"><span>YOUR PLAYLISTS</span><button type="button" className="icon-button" aria-label="建立播放清單" onClick={() => setCreateOpen(true)}><IconPlus size={18} /></button></div>
          <div className="sidebar__playlists">
            {playlists.length ? playlists.map((playlist) => <NavLink key={playlist.id} to={`/playlist/${playlist.id}`}><IconDisc size={17} /><span>{playlist.name}</span></NavLink>) : <button type="button" className="sidebar__empty" onClick={() => setCreateOpen(true)}>還沒有播放清單<br /><strong>建立第一個</strong></button>}
          </div>
        </div>
        <div className="sidebar__account">
          <span className="avatar"><IconUser size={17} /></span><span><strong>{user.username}</strong><small>{user.role === 'admin' ? '管理員' : '使用者'}</small></span>
          <NavLink to="/settings" className="icon-button" aria-label="設定"><IconSettings size={18} /></NavLink>
          <button type="button" className="icon-button" aria-label="登出" onClick={() => void logout()}><IconLogout size={18} /></button>
        </div>
      </aside>
      <div className={`app-shell__body${hasPlayer ? ' app-shell__body--with-player' : ''}`}>
        <header className={`topbar${isSearchPage ? ' topbar--search' : ''}`}>
          <div className="history-controls">{!isHomePage && <button type="button" className="round-button" aria-label="返回" onClick={() => navigate(-1)}><IconChevronLeft size={19} /></button>}</div>
          <NavLink to="/" className="topbar__mobile-brand" aria-label="Ascooo Music 首頁"><img src="/brand-logo/music-logo.png" width="1000" height="1000" alt="" aria-hidden="true" draggable={false} /></NavLink>
          <form className="global-search" role="search" onSubmit={search}><IconSearch size={19} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜尋歌曲、專輯或藝人" aria-label="搜尋音樂庫" /><kbd>⌘ K</kbd></form>
          <NavLink to="/settings" className="topbar__profile"><span>{user.username.slice(0, 1).toUpperCase()}</span><b>{user.username}</b></NavLink>
        </header>
        <main className={`page${isRestoringHistory ? ' page--history' : ''}`} key={location.pathname}><Outlet /></main>
        <SiteFooter />
      </div>
      <nav className="mobile-nav" aria-label="行動版主要導覽">{mainNav.slice(0, 3).map(({ to, label, icon: Icon, end }) => <NavLink key={to} to={to} end={end} className={({ isActive }) => isActive ? 'is-active' : ''}><Icon size={21} /><span>{label}</span></NavLink>)}<NavLink to="/settings" className={({ isActive }) => isActive ? 'is-active' : ''}><IconSettings size={21} /><span>設定</span></NavLink></nav>
      <QueuePanel />
      <PlayerBar />
      <NowPlaying />
      <CreatePlaylistDialog open={createOpen} onClose={() => setCreateOpen(false)} />
    </div>
  );
}
