import { useCallback, useEffect, useLayoutEffect, useRef, useState, type FormEvent } from 'react';
import { Link, NavLink, Outlet, useLocation, useNavigate, useNavigationType } from 'react-router-dom';
import { api } from '../api/client';
import { requireLogin } from '../lib/login-gate';
import { usePlayer } from '../store/player';
import { useSession } from '../store/session';
import { toast } from '../store/toast';
import {
  IconChevronLeft,
  IconClose,
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
  { to: '/discover', label: '首頁', icon: IconHome, end: true },
  { to: '/search', label: '搜尋', icon: IconSearch },
  { to: '/library', label: '音樂庫', icon: IconLibrary },
  { to: '/favorites', label: '喜愛的歌曲', icon: IconHeart },
];

const searchShortcutLabel = typeof navigator !== 'undefined'
  && /Mac|iPhone|iPad|iPod/i.test((navigator as Navigator & { userAgentData?: { platform?: string } }).userAgentData?.platform ?? navigator.platform)
  ? '⌘ K'
  : 'Ctrl K';

const legalLinks = [
  { href: 'https://ascooo.com/privacy', label: '隱私權政策' },
  { href: 'https://ascooo.com/terms', label: '使用條款' },
  { href: '/copyright', label: '版權聲明' },
];

function getDocumentTitle(pathname: string, search: string) {
  if (pathname === '/discover') return 'Ascooo Music';

  let pageTitle: string;
  if (pathname === '/search') {
    const query = new URLSearchParams(search).get('q')?.trim();
    pageTitle = query ? `搜尋「${query}」` : '搜尋';
  } else if (pathname === '/library') pageTitle = '音樂庫';
  else if (pathname === '/favorites') pageTitle = '喜愛的歌曲';
  else if (pathname === '/settings') pageTitle = '設定';
  else if (pathname === '/copyright') pageTitle = '版權聲明';
  else if (pathname.startsWith('/album/')) pageTitle = '專輯';
  else if (pathname.startsWith('/artist/')) pageTitle = '藝人';
  else if (pathname.startsWith('/playlist/')) pageTitle = '播放清單';
  else pageTitle = '找不到頁面';

  return `${pageTitle} · Ascooo Music`;
}

function isTextEntryTarget(target: EventTarget | null) {
  if (!(target instanceof Element)) return false;
  const field = target.closest('input, textarea, select, [contenteditable="true"], [role="textbox"]');
  return Boolean(field) && !field?.matches('input[type="range"], input[type="checkbox"], input[type="radio"], input[type="button"], input[type="submit"]');
}

function Brand() {
  return <NavLink to="/discover" className="brand" aria-label="Ascooo Music 首頁"><img className="brand__image" src="/brand-logo/ascooo-music_light.png" width="750" height="320" alt="" aria-hidden="true" draggable={false} /></NavLink>;
}

function SiteFooter() {
  return (
    <footer className="site-footer">
      <p className="site-footer__copyright">© {new Date().getFullYear()} Ascooo. All rights reserved.</p>
      <nav className="site-footer__links" aria-label="法律資訊">
        {legalLinks.map(({ href, label }) => (href.startsWith('/')
          ? <Link key={href} to={href}>{label}</Link>
          : <a key={href} href={href} target="_blank" rel="noopener noreferrer">{label}</a>
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
        <h2 id="playlist-dialog-title">建立播放清單</h2>
        <form onSubmit={submit}><label><span>名稱</span><input autoFocus value={name} onChange={(event) => setName(event.target.value)} placeholder="例如：週日午後" maxLength={100} /></label><div className="dialog__actions"><button type="button" className="text-button" onClick={onClose}>取消</button><button type="submit" className="primary-button" disabled={!name.trim() || pending}>{pending ? '建立中…' : '建立'}</button></div></form>
      </section>
    </div>
  );
}

export function Shell() {
  const user = useSession((s) => s.user);
  const playlists = useSession((s) => s.playlists);
  const logout = useSession((s) => s.logout);
  const currentTrack = usePlayer((s) => s.queue[s.index]);
  const isNowPlayingOpen = usePlayer((s) => s.nowPlayingOpen);
  const hasPlayer = Boolean(currentTrack);
  const location = useLocation();
  const navigate = useNavigate();
  const navigationType = useNavigationType();
  const scrollPositions = useRef(new Map<string, number>());
  const activeLocationKey = useRef(location.key);
  const previousPathname = useRef<string | null>(null);
  const [query, setQuery] = useState(new URLSearchParams(location.search).get('q') ?? '');
  const searchInputRef = useRef<HTMLInputElement>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [dynamicPageTitle, setDynamicPageTitle] = useState<{ pathname: string; title: string } | null>(null);
  const isHomePage = location.pathname === '/discover';
  const isSearchPage = location.pathname === '/search';
  const isRestoringHistory = navigationType === 'POP' && scrollPositions.current.has(location.key);
  const navigationPageTitle = typeof location.state?.pageTitle === 'string'
    ? location.state.pageTitle.trim()
    : '';
  const setPageTitle = useCallback((title: string | null) => {
    setDynamicPageTitle(title ? { pathname: location.pathname, title } : null);
  }, [location.pathname]);

  useLayoutEffect(() => {
    const immediatePageTitle = dynamicPageTitle?.pathname === location.pathname
      ? dynamicPageTitle.title
      : navigationPageTitle;
    const routeTitle = immediatePageTitle
      ? `${immediatePageTitle} · Ascooo Music`
      : getDocumentTitle(location.pathname, location.search);
    document.title = isNowPlayingOpen && currentTrack
      ? `${currentTrack.title} · ${currentTrack.artist}`
      : routeTitle;
  }, [currentTrack, dynamicPageTitle, isNowPlayingOpen, location.pathname, location.search, navigationPageTitle]);

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
        searchInputRef.current?.focus();
      }
    };
    window.addEventListener('keydown', focusSearch);
    return () => window.removeEventListener('keydown', focusSearch);
  }, []);

  useEffect(() => {
    // Remember which element got focus from a mouse/touch press. Space should control
    // playback there instead of re-activating whatever was last clicked, while
    // elements reached with the keyboard keep their native Space behaviour.
    let pointerPressed = false;
    let pointerFocused: Element | null = null;
    const markPointer = () => { pointerPressed = true; };
    const markKeyboard = () => { pointerPressed = false; };
    const trackFocus = (event: FocusEvent) => {
      pointerFocused = pointerPressed && event.target instanceof Element ? event.target : null;
    };

    const togglePlayback = (event: KeyboardEvent) => {
      if (
        event.code !== 'Space'
        || event.repeat
        || event.metaKey
        || event.ctrlKey
        || event.altKey
        || event.shiftKey
        || event.defaultPrevented
        || isTextEntryTarget(event.target)
      ) return;

      const focused = document.activeElement;
      const hasKeyboardFocus = focused instanceof HTMLElement && focused !== document.body && focused !== pointerFocused;
      if (hasKeyboardFocus) return;

      const player = usePlayer.getState();
      if (!player.queue[player.index]) return;
      event.preventDefault();
      // Drop focus from the clicked element so the Space keyup can't activate it.
      if (focused instanceof HTMLElement && focused !== document.body) focused.blur();
      player.toggle();
    };

    window.addEventListener('pointerdown', markPointer, true);
    window.addEventListener('keydown', markKeyboard, true);
    document.addEventListener('focusin', trackFocus, true);
    window.addEventListener('keydown', togglePlayback);
    return () => {
      window.removeEventListener('pointerdown', markPointer, true);
      window.removeEventListener('keydown', markKeyboard, true);
      document.removeEventListener('focusin', trackFocus, true);
      window.removeEventListener('keydown', togglePlayback);
    };
  }, []);

  const loginState = { from: location.pathname + location.search + location.hash };
  const openCreatePlaylist = () => { if (requireLogin()) setCreateOpen(true); };

  function search(event: FormEvent) {
    event.preventDefault();
    navigate(`/search${query.trim() ? `?q=${encodeURIComponent(query.trim())}` : ''}`);
  }

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <Brand />
        <nav className="sidebar__nav" aria-label="主要導覽">
          {(user ? mainNav : mainNav.slice(0, 3)).map(({ to, label, icon: Icon, end }) => <NavLink key={to} to={to} end={end} className={({ isActive }) => isActive ? 'is-active' : ''}><Icon size={20} /><span>{label}</span></NavLink>)}
        </nav>
        {user ? <div className="sidebar__section">
          <div className="sidebar__section-title"><span>YOUR PLAYLISTS</span><button type="button" className="icon-button" aria-label="建立播放清單" onClick={openCreatePlaylist}><IconPlus size={18} /></button></div>
          <div className="sidebar__playlists">
            {playlists.length ? playlists.map((playlist) => <NavLink key={playlist.id} to={`/playlist/${playlist.id}`}><IconDisc size={17} /><span>{playlist.name}</span></NavLink>) : <button type="button" className="sidebar__empty" onClick={openCreatePlaylist}>還沒有播放清單<br /><strong>建立第一個</strong></button>}
          </div>
        </div> : null}
        {user ? (
          <div className="sidebar__account">
            <span className="avatar"><IconUser size={17} /></span><span><strong>{user.username}</strong><small>{user.role === 'admin' ? '管理員' : '使用者'}</small></span>
            <NavLink to="/settings" className="icon-button" aria-label="設定"><IconSettings size={18} /></NavLink>
            <button type="button" className="icon-button" aria-label="登出" onClick={() => void logout()}><IconLogout size={18} /></button>
          </div>
        ) : (
          <div className="sidebar__account sidebar__account--guest">
            <Link to="/login" state={loginState} className="primary-button">登入</Link>
          </div>
        )}
      </aside>
      <div className={`app-shell__body${hasPlayer ? ' app-shell__body--with-player' : ''}`}>
        <header className={`topbar${isSearchPage ? ' topbar--search' : ''}`}>
          <div className="history-controls">{!isHomePage && <button type="button" className="round-button" aria-label="返回" onClick={() => navigate(-1)}><IconChevronLeft size={19} /></button>}</div>
          <NavLink to="/discover" className="topbar__mobile-brand" aria-label="Ascooo Music 首頁"><img src="/brand-logo/music-logo.png" width="1000" height="1000" alt="" aria-hidden="true" draggable={false} /></NavLink>
          <form className="global-search" role="search" onSubmit={search}><IconSearch size={19} /><input ref={searchInputRef} value={query} onChange={(event) => setQuery(event.target.value)} onKeyDown={(event) => { if (event.key === 'Escape') event.currentTarget.blur(); }} placeholder="搜尋歌曲、專輯或藝人" aria-label="搜尋音樂庫" />{query ? <button type="button" className="global-search__clear" onClick={() => { setQuery(''); searchInputRef.current?.focus(); }} aria-label="清除搜尋文字"><IconClose size={16} /></button> : <kbd>{searchShortcutLabel}</kbd>}</form>
          {user
            ? <NavLink to="/settings" className="topbar__profile"><span>{user.username.slice(0, 1).toUpperCase()}</span><b>{user.username}</b></NavLink>
            : <Link to="/login" state={loginState} className="topbar__login">登入</Link>}
        </header>
        <main className={`page${isRestoringHistory ? ' page--history' : ''}`} key={location.pathname}><Outlet context={setPageTitle} /></main>
        <SiteFooter />
      </div>
      <nav className={`mobile-nav${user ? '' : ' mobile-nav--guest'}`} aria-label="行動版主要導覽">{mainNav.slice(0, 3).map(({ to, label, icon: Icon, end }) => <NavLink key={to} to={to} end={end} className={({ isActive }) => isActive ? 'is-active' : ''}><Icon size={21} /><span>{label}</span></NavLink>)}{user ? <NavLink to="/settings" className={({ isActive }) => isActive ? 'is-active' : ''}><IconSettings size={21} /><span>設定</span></NavLink> : null}</nav>
      <QueuePanel />
      <PlayerBar />
      <NowPlaying />
      <CreatePlaylistDialog open={createOpen} onClose={() => setCreateOpen(false)} />
    </div>
  );
}
