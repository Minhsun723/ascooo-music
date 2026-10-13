import { useCallback, useEffect, useState, type DependencyList, type FormEvent } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { api } from './api/client';
import type { Album, Artist, HomeData, ManagedTrack, ManagedTrackStats, Track } from './api/types';
import { formatLongDuration } from './lib/format';
import { usePlayer } from './store/player';
import { useSession } from './store/session';
import { useLibrarySync } from './store/sync';
import { toast } from './store/toast';
import { Artwork } from './components/Artwork';
import { DolbyLogo } from './components/DolbyLogo';
import { AlbumGrid, ArtistGrid, PlaylistGrid } from './components/MediaGrid';
import { TrackList } from './components/TrackList';
import { IconDisc, IconEye, IconEyeOff, IconHeart, IconMusic, IconPlay, IconSearch, IconShuffle, IconSync, IconWave } from './components/Icons';

interface RequestState<T> {
  data: T | null;
  loading: boolean;
  error: string;
}

function useRequest<T>(loader: () => Promise<T>, dependencies: DependencyList): RequestState<T> & { reload: () => void } {
  const [version, setVersion] = useState(0);
  const [state, setState] = useState<RequestState<T>>({ data: null, loading: true, error: '' });
  useEffect(() => {
    let active = true;
    setState((current) => ({ ...current, loading: true, error: '' }));
    loader().then((data) => { if (active) setState({ data, loading: false, error: '' }); }).catch((error) => { if (active) setState({ data: null, loading: false, error: (error as Error).message }); });
    return () => { active = false; };
    // The page defines the relevant request dependencies at the callsite.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...dependencies, version]);
  return { ...state, reload: () => setVersion((value) => value + 1) };
}

function LoadingBlock({ rows = 4 }: { rows?: number }) {
  return <div className="loading-block" aria-label="載入中">{Array.from({ length: rows }, (_, index) => <span key={index} />)}</div>;
}

function RequestError({ message, retry }: { message: string; retry?: () => void }) {
  return <div className="request-error" role="alert"><IconWave size={26} /><h2>暫時讀不到音樂庫</h2><p>{message}</p>{retry ? <button type="button" className="secondary-button" onClick={retry}>再試一次</button> : null}</div>;
}

function EmptyState({ icon = <IconMusic />, title, copy, action }: { icon?: React.ReactNode; title: string; copy: string; action?: React.ReactNode }) {
  return <div className="empty-state"><span>{icon}</span><h2>{title}</h2><p>{copy}</p>{action}</div>;
}

function SectionHeading({ title, link }: { title: string; link?: string }) {
  return <div className="section-heading"><div><h2>{title}</h2></div>{link ? <Link to={link}>查看全部 <span aria-hidden="true">↗</span></Link> : null}</div>;
}

export function HomePage() {
  const request = useRequest<HomeData>(() => api.home(), []);
  if (request.loading && !request.data) return <LoadingBlock rows={7} />;
  if (request.error || !request.data) return <RequestError message={request.error} retry={request.reload} />;
  const data = request.data;

  return (
    <>
      {data.quickPicks.length ? <section className="page-section"><SectionHeading title="現在就播放" link="/library?tab=tracks" /><TrackList tracks={data.quickPicks.slice(0, 10)} compact numbered={false} /></section> : null}
      {data.recentAlbums.length ? <section className="page-section"><SectionHeading title="新進唱片櫃" link="/library?tab=albums" /><AlbumGrid albums={data.recentAlbums.slice(0, 6)} /></section> : null}
      {data.recentPlays.length ? <section className="page-section"><SectionHeading title="最近聽過" /><TrackList tracks={data.recentPlays.slice(0, 8)} compact numbered={false} /></section> : null}
      {data.randomAlbums.length ? <section className="page-section"><SectionHeading title="再翻一張唱片" /><AlbumGrid albums={data.randomAlbums.slice(0, 6)} /></section> : null}
      {!data.stats.tracks ? <EmptyState title="音樂庫還是空的" copy="到設定頁連線 PikPak，執行第一次同步後，歌曲就會出現在這裡。" action={<Link to="/settings" className="primary-button"><IconSync size={18} />前往同步設定</Link>} /> : null}
    </>
  );
}

function PageIntro({ title, copy, children }: { title: string; copy?: string; children?: React.ReactNode }) {
  return <><header className="page-intro"><h1>{title}</h1>{copy ? <p>{copy}</p> : null}</header>{children}</>;
}

export function SearchPage() {
  const [params] = useSearchParams();
  const query = params.get('q')?.trim() ?? '';
  const [state, setState] = useState<RequestState<{ tracks: Track[]; albums: Album[]; artists: Artist[] }>>({ data: null, loading: false, error: '' });

  useEffect(() => {
    if (!query) { setState({ data: null, loading: false, error: '' }); return; }
    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      setState((current) => ({ ...current, loading: true, error: '' }));
      api.search(query, controller.signal).then((data) => setState({ data, loading: false, error: '' })).catch((error) => { if (error.name !== 'AbortError') setState({ data: null, loading: false, error: (error as Error).message }); });
    }, 180);
    return () => { window.clearTimeout(timer); controller.abort(); };
  }, [query]);

  if (!query) return <PageIntro title="找一段熟悉的聲音"><EmptyState icon={<IconSearch />} title="搜尋你的所有收藏" copy="輸入歌曲、專輯或藝人名稱，結果會從 D1 索引即時找出來。" /></PageIntro>;
  if (state.error) return <RequestError message={state.error} />;
  const resultCount = (state.data?.tracks.length ?? 0) + (state.data?.albums.length ?? 0) + (state.data?.artists.length ?? 0);

  return <><PageIntro title={`「${query}」`} copy={state.loading ? '正在搜尋…' : `找到 ${resultCount} 個結果`} />{state.loading && !state.data ? <LoadingBlock rows={6} /> : null}{state.data?.artists.length ? <section className="page-section"><SectionHeading title="藝人" /><ArtistGrid artists={state.data.artists} /></section> : null}{state.data?.albums.length ? <section className="page-section"><SectionHeading title="專輯" /><AlbumGrid albums={state.data.albums} /></section> : null}{state.data?.tracks.length ? <section className="page-section"><SectionHeading title="歌曲" /><TrackList tracks={state.data.tracks} /></section> : null}{state.data && !resultCount ? <EmptyState title="沒有相符的音樂" copy="試試藝人全名、專輯名稱，或縮短搜尋字詞。" /> : null}</>;
}

type LibraryData = { tracks: Track[]; total: number; albums: Album[]; artists: Artist[] };

export function LibraryPage() {
  const [params, setParams] = useSearchParams();
  const tab = params.get('tab') ?? 'albums';
  const playlists = useSession((s) => s.playlists);
  const request = useRequest<LibraryData>(async () => {
    const [tracks, albums, artists] = await Promise.all([api.tracks('added', 500), api.albums('added', 300), api.artists()]);
    return { ...tracks, albums: albums.albums, artists: artists.artists };
  }, []);
  const tabs = [{ id: 'albums', label: '專輯' }, { id: 'tracks', label: '歌曲' }, { id: 'artists', label: '藝人' }, { id: 'playlists', label: '播放清單' }];
  return <><PageIntro title="音樂庫" copy={request.data ? `${request.data.total.toLocaleString()} 首歌曲，依你的方式整理。` : '所有收藏都在這裡。'} /><div className="segmented-tabs" role="tablist" aria-label="音樂庫分類">{tabs.map((item) => <button type="button" role="tab" aria-selected={tab === item.id} className={tab === item.id ? 'is-active' : ''} key={item.id} onClick={() => setParams({ tab: item.id })}>{item.label}</button>)}</div>{request.loading ? <LoadingBlock rows={7} /> : null}{request.error ? <RequestError message={request.error} retry={request.reload} /> : null}{request.data && tab === 'albums' ? request.data.albums.length ? <AlbumGrid albums={request.data.albums} /> : <EmptyState title="還沒有專輯" copy="同步歌曲後，系統會依照內嵌資訊整理專輯。" /> : null}{request.data && tab === 'tracks' ? request.data.tracks.length ? <TrackList tracks={request.data.tracks} /> : <EmptyState title="還沒有歌曲" copy="前往設定頁執行 PikPak 同步。" /> : null}{request.data && tab === 'artists' ? request.data.artists.length ? <ArtistGrid artists={request.data.artists} /> : <EmptyState title="還沒有藝人" copy="同步歌曲後，藝人會自動出現在這裡。" /> : null}{tab === 'playlists' ? playlists.length ? <PlaylistGrid playlists={playlists} /> : <EmptyState icon={<IconDisc />} title="還沒有播放清單" copy="從歌曲選單加入現有清單，或從左側建立新清單。" /> : null}</>;
}

function CollectionHero({ artworkId, title, subtitle, meta = '', badge, tracks, compactTitle = false, albumLayout = false }: { artworkId?: string | null; title: string; subtitle?: string; meta?: string; badge?: React.ReactNode; tracks: Track[]; compactTitle?: boolean; albumLayout?: boolean }) {
  const playList = usePlayer((s) => s.playList);
  const hasMeta = !!(meta || badge);
  return <header className={`collection-hero${compactTitle ? ' collection-hero--compact-title' : ''}${albumLayout ? ' collection-hero--album' : ''}`}><Artwork artworkId={artworkId} title={title} artist={subtitle} className="collection-hero__art" loading="eager" /><div className="collection-hero__copy"><div className="collection-hero__details"><h1>{title}</h1>{subtitle ? <p>{subtitle}</p> : null}{hasMeta ? <small className="collection-hero__meta">{meta ? <span>{meta}</span> : null}{badge ? <>{meta ? <i aria-hidden="true">·</i> : null}{badge}</> : null}</small> : null}</div><div className="collection-hero__actions"><button type="button" className="primary-button" disabled={!tracks.length} onClick={() => playList(tracks)}><IconPlay size={18} />播放</button><button type="button" className="round-button round-button--outline" disabled={!tracks.length} aria-label="隨機播放" onClick={() => playList(tracks, 0, { shuffle: true })}><IconShuffle size={19} /></button></div></div></header>;
}

export function AlbumPage() {
  const id = Number(useParams().id);
  const request = useRequest(() => api.album(id), [id]);
  if (request.loading) return <LoadingBlock rows={8} />;
  if (request.error || !request.data) return <RequestError message={request.error} retry={request.reload} />;
  const { album, tracks, moreByArtist } = request.data;
  const heroMeta = [album.genre, album.year ? `${album.year} 年` : null].filter(Boolean).join(' · ');
  return <><CollectionHero artworkId={album.artworkId} title={album.title} subtitle={album.artist} meta={heroMeta} badge={album.atmos ? <DolbyLogo variant="atmos" /> : album.lossless ? <span className="quality-badge">LOSSLESS</span> : undefined} tracks={tracks} compactTitle albumLayout /><section className="page-section page-section--tight"><TrackList tracks={tracks} /><footer className="album-summary">{album.year ? <span>{album.year} 年</span> : null}<span>{album.trackCount} 首歌曲 · {formatLongDuration(album.duration)}</span>{album.recordLabel ? <span>℗ {album.year ? `${album.year} ` : ''}{album.recordLabel}</span> : null}</footer></section>{moreByArtist.length ? <section className="page-section"><SectionHeading title={`更多 ${album.artist}`} /><AlbumGrid albums={moreByArtist} /></section> : null}</>;
}

export function ArtistPage() {
  const id = Number(useParams().id);
  const request = useRequest(() => api.artist(id), [id]);
  if (request.loading) return <LoadingBlock rows={8} />;
  if (request.error || !request.data) return <RequestError message={request.error} retry={request.reload} />;
  const { artist, tracks, albums } = request.data;
  return <><CollectionHero artworkId={artist.artworkId} title={artist.name} meta={`${albums.length} 張專輯 · ${tracks.length} 首熱門歌曲`} tracks={tracks} /><section className="page-section page-section--tight"><SectionHeading title="熱門歌曲" /><TrackList tracks={tracks.slice(0, 10)} /></section>{albums.length ? <section className="page-section"><SectionHeading title="專輯" /><AlbumGrid albums={albums} /></section> : null}</>;
}

export function FavoritesPage() {
  const request = useRequest(() => api.favorites(), []);
  const tracks = request.data?.tracks ?? [];
  return <><PageIntro title="喜愛的歌曲" copy={tracks.length ? `${tracks.length} 首你不想錯過的歌。` : '把想一聽再聽的歌放在這裡。'} />{request.loading ? <LoadingBlock rows={6} /> : request.error ? <RequestError message={request.error} retry={request.reload} /> : tracks.length ? <TrackList tracks={tracks} /> : <EmptyState icon={<IconHeart />} title="還沒有喜愛的歌曲" copy="點一下歌曲旁的愛心，它就會收藏在這裡。" />}</>;
}

export function PlaylistPage() {
  const id = Number(useParams().id);
  const request = useRequest(() => api.playlist(id), [id]);
  const refreshPlaylists = useSession((s) => s.refreshPlaylists);
  const remove = useCallback(async (track: Track) => {
    if (!track.entryId) return;
    try { await api.removeFromPlaylist(id, track.entryId); request.reload(); await refreshPlaylists(); toast('已從播放清單移除'); } catch (error) { toast((error as Error).message, 'error'); }
  }, [id, refreshPlaylists, request]);
  if (request.loading) return <LoadingBlock rows={8} />;
  if (request.error || !request.data) return <RequestError message={request.error} retry={request.reload} />;
  const { playlist, tracks } = request.data;
  return <><CollectionHero artworkId={tracks[0]?.artworkId} title={playlist.name} subtitle={playlist.description ?? undefined} meta={`${tracks.length} 首歌 · 更新於 ${new Date(playlist.updatedAt).toLocaleDateString('zh-TW')}`} tracks={tracks} />{tracks.length ? <section className="page-section page-section--tight"><TrackList tracks={tracks} onRemove={(track) => void remove(track)} /></section> : <EmptyState icon={<IconDisc />} title="這個播放清單是空的" copy="從任一首歌的更多選單，把歌曲加進來。" />}</>;
}

type VisibilityFilter = 'all' | 'visible' | 'hidden';
const MANAGE_PAGE_SIZE = 100;

function MusicVisibilityManager() {
  const [filter, setFilter] = useState<VisibilityFilter>('all');
  const [searchInput, setSearchInput] = useState('');
  const [query, setQuery] = useState('');
  const [tracks, setTracks] = useState<ManagedTrack[]>([]);
  const [stats, setStats] = useState<ManagedTrackStats>({ total: 0, visible: 0, hidden: 0 });
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState('');
  const [updating, setUpdating] = useState<Set<number>>(() => new Set());

  useEffect(() => {
    const timer = window.setTimeout(() => setQuery(searchInput.trim()), 220);
    return () => window.clearTimeout(timer);
  }, [searchInput]);

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError('');
    api.managedTracks(filter, query, MANAGE_PAGE_SIZE)
      .then((result) => {
        if (!active) return;
        setTracks(result.tracks);
        setTotal(result.total);
        setStats(result.stats);
      })
      .catch((requestError) => { if (active) setError((requestError as Error).message); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [filter, query]);

  async function loadMore() {
    setLoadingMore(true);
    try {
      const result = await api.managedTracks(filter, query, MANAGE_PAGE_SIZE, tracks.length);
      setTracks((current) => [...current, ...result.tracks]);
      setTotal(result.total);
      setStats(result.stats);
    } catch (requestError) {
      toast((requestError as Error).message, 'error');
    } finally {
      setLoadingMore(false);
    }
  }

  async function toggleVisibility(track: ManagedTrack) {
    const nextVisible = !track.visible;
    setUpdating((current) => new Set(current).add(track.id));
    try {
      await api.setTrackVisibility(track.id, nextVisible);
      setStats((current) => ({
        ...current,
        visible: current.visible + (nextVisible ? 1 : -1),
        hidden: current.hidden + (nextVisible ? -1 : 1),
      }));
      setTotal((current) => filter === 'all' ? current : Math.max(0, current - 1));
      setTracks((current) => filter === 'all'
        ? current.map((item) => item.id === track.id ? { ...item, visible: nextVisible } : item)
        : current.filter((item) => item.id !== track.id));
      toast(nextVisible ? `已顯示「${track.title}」` : `已隱藏「${track.title}」`);
    } catch (requestError) {
      toast((requestError as Error).message, 'error');
    } finally {
      setUpdating((current) => {
        const next = new Set(current);
        next.delete(track.id);
        return next;
      });
    }
  }

  const filters: { id: VisibilityFilter; label: string; count: number }[] = [
    { id: 'all', label: '全部', count: stats.total },
    { id: 'visible', label: '顯示中', count: stats.visible },
    { id: 'hidden', label: '已隱藏', count: stats.hidden },
  ];

  return (
    <section className="settings-card settings-card--wide music-manager">
      <div className="music-manager__heading">
        <div>
          <h2>管理音樂</h2>
        </div>
        <div className="music-manager__stats" aria-live="polite">
          <strong>{stats.visible.toLocaleString()}</strong>
          <span>首正在顯示</span>
        </div>
      </div>

      <div className="music-manager__toolbar">
        <div className="visibility-filters" role="group" aria-label="篩選歌曲顯示狀態">
          {filters.map((item) => (
            <button type="button" className={filter === item.id ? 'is-active' : ''} aria-pressed={filter === item.id} key={item.id} onClick={() => setFilter(item.id)}>
              {item.label}<span>{item.count.toLocaleString()}</span>
            </button>
          ))}
        </div>
        <label className="music-manager__search">
          <span className="sr-only">搜尋歌曲、藝人或專輯</span>
          <IconSearch size={17} />
          <input type="search" value={searchInput} onChange={(event) => setSearchInput(event.target.value)} placeholder="搜尋歌曲、藝人或專輯" />
        </label>
      </div>

      {loading ? <LoadingBlock rows={4} /> : null}
      {!loading && error ? <div className="music-manager__message" role="alert"><p>{error}</p></div> : null}
      {!loading && !error && !tracks.length ? (
        <div className="music-manager__message"><IconMusic size={22} /><p>{query ? '找不到符合搜尋的歌曲。' : filter === 'hidden' ? '目前沒有隱藏的歌曲。' : '目前沒有可管理的歌曲。'}</p></div>
      ) : null}
      {!loading && !error && tracks.length ? (
        <div className="managed-track-list" role="region" aria-label="音樂清單，可捲動" tabIndex={0}>
          {tracks.map((track) => {
            const isUpdating = updating.has(track.id);
            return (
              <div className={`managed-track${track.visible ? '' : ' is-hidden'}`} key={track.id}>
                <Artwork artworkId={track.artworkId} title={track.title} artist={track.artist} className="managed-track__art" />
                <div className="managed-track__copy">
                  <strong>{track.title}</strong>
                  <span>{[track.artist, track.album].filter(Boolean).join(' · ')}</span>
                </div>
                <span className={`managed-track__state ${track.visible ? 'is-visible' : ''}`}>
                  {track.visible ? <IconEye size={15} /> : <IconEyeOff size={15} />}
                  {track.visible ? '顯示中' : '已隱藏'}
                </span>
                <button
                  type="button"
                  className={`visibility-switch ${track.visible ? 'is-on' : ''}`}
                  role="switch"
                  aria-checked={track.visible}
                  aria-label={`${track.visible ? '隱藏' : '顯示'}歌曲「${track.title}」`}
                  disabled={isUpdating}
                  onClick={() => void toggleVisibility(track)}
                >
                  <span aria-hidden="true" />
                </button>
              </div>
            );
          })}
        </div>
      ) : null}
      {!loading && !error && tracks.length < total ? (
        <button type="button" className="secondary-button music-manager__more" disabled={loadingMore} onClick={() => void loadMore()}>
          {loadingMore ? '載入中…' : `載入更多（尚有 ${(total - tracks.length).toLocaleString()} 首）`}
        </button>
      ) : null}
    </section>
  );
}

export function SettingsPage() {
  const user = useSession((s) => s.user)!;
  const status = useLibrarySync((s) => s.status);
  const syncing = useLibrarySync((s) => s.syncing);
  const progress = useLibrarySync((s) => s.progress);
  const loadStatus = useLibrarySync((s) => s.loadStatus);
  const runSync = useLibrarySync((s) => s.run);
  const [passwords, setPasswords] = useState({ current: '', next: '' });
  const [savingPassword, setSavingPassword] = useState(false);

  useEffect(() => { if (user.role === 'admin') void loadStatus().catch(() => {}); }, [loadStatus, user.role]);

  async function changePassword(event: FormEvent) {
    event.preventDefault();
    setSavingPassword(true);
    try { await api.auth.changePassword(passwords.current, passwords.next); setPasswords({ current: '', next: '' }); toast('密碼已更新'); } catch (error) { toast((error as Error).message, 'error'); } finally { setSavingPassword(false); }
  }

  return (
    <>
      <PageIntro title="設定" copy="管理音樂來源、顯示內容與帳號安全。" />
      <div className="settings-grid">
        <section className="settings-card settings-card--wide">
          <div className="settings-card__heading">
            <div><h2>PikPak 音樂庫</h2></div>
            <span className={`status-dot ${status ? 'is-online' : ''}`}>{status ? '已連線' : '等待檢查'}</span>
          </div>
          {user.role === 'admin' ? (
            <>
              <div className="sync-summary">
                <div><strong>{status?.ready.toLocaleString() ?? '—'}</strong><span>可播放歌曲</span></div>
                <div><strong>{status?.pending.toLocaleString() ?? '—'}</strong><span>等待處理</span></div>
                <div><strong>{status?.errorCount.toLocaleString() ?? '—'}</strong><span>需留意</span></div>
              </div>
              <div className="sync-root"><span>同步根目錄</span><code>{status?.root ?? '從 Worker 設定讀取'}</code></div>
              {progress ? <div className="sync-progress" role="status"><span className={syncing ? 'is-spinning' : ''}><IconSync size={17} /></span>{progress}</div> : null}
              <button type="button" className="primary-button" disabled={syncing} onClick={() => void runSync()}><IconSync size={18} />遠端同步</button>
            </>
          ) : <p className="settings-note">只有管理員可以執行音樂庫同步。</p>}
        </section>

        {user.role === 'admin' ? <MusicVisibilityManager /> : null}

        <section className="settings-card">
          <h2>變更密碼</h2>
          <form className="settings-form" onSubmit={changePassword}>
            <label><span>目前密碼</span><input type="password" autoComplete="current-password" value={passwords.current} onChange={(event) => setPasswords((value) => ({ ...value, current: event.target.value }))} required /></label>
            <label><span>新密碼</span><input type="password" autoComplete="new-password" minLength={8} value={passwords.next} onChange={(event) => setPasswords((value) => ({ ...value, next: event.target.value }))} required /></label>
            <button type="submit" className="secondary-button" disabled={savingPassword}>{savingPassword ? '更新中…' : '更新密碼'}</button>
          </form>
        </section>
      </div>
    </>
  );
}

export function NotFoundPage() {
  const navigate = useNavigate();
  return <EmptyState title="這裡沒有音樂" copy="這個頁面可能已移動，回到音樂庫繼續聽吧。" action={<button type="button" className="primary-button" onClick={() => navigate('/')}><IconPlay size={18} />回到首頁</button>} />;
}
