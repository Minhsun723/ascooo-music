import type { Album, Artist, HomeData, Lyrics, ManagedTrack, ManagedTrackStats, ManagedUser, Playlist, SyncStatus, Track, User } from './types';

export class ApiError extends Error {
  constructor(
    message: string,
    public status: number,
  ) {
    super(message);
  }
}

let onUnauthorized: (() => void) | null = null;
export const setUnauthorizedHandler = (fn: () => void) => {
  onUnauthorized = fn;
};

async function request<T>(path: string, init: RequestInit & { json?: unknown } = {}): Promise<T> {
  const { json, ...rest } = init;
  const res = await fetch(`/api${path}`, {
    credentials: 'same-origin',
    ...rest,
    headers: { ...(json !== undefined ? { 'Content-Type': 'application/json' } : {}), ...rest.headers },
    body: json !== undefined ? JSON.stringify(json) : rest.body,
  });
  if (!res.ok) {
    let message = `HTTP ${res.status}`;
    try {
      message = (await res.json()).error ?? message;
    } catch {
      /* not json */
    }
    if (res.status === 401 && !path.startsWith('/auth/')) onUnauthorized?.();
    throw new ApiError(message, res.status);
  }
  return res.json() as Promise<T>;
}

const get = <T>(p: string) => request<T>(p);
const post = <T>(p: string, json?: unknown) => request<T>(p, { method: 'POST', json: json ?? {} });

export type AudioSource = 'original' | 'aac51';
export const streamUrl = (id: number, source: AudioSource = 'original') =>
  source === 'aac51' ? `/api/stream/${id}?v=aac51` : `/api/stream/${id}`;
export type ArtworkSize = 512 | 2000;
export const artUrl = (id: string | null | undefined, size: ArtworkSize = 512) =>
  (id ? `/api/art/${id}/${size}?v=1` : null);

export const api = {
  auth: {
    status: () => get<{ needsSetup: boolean; user: User | null }>('/auth/status'),
    setup: (username: string, password: string) => post<{ user: User }>('/auth/setup', { username, password }),
    login: (username: string, password: string) => post<{ user: User }>('/auth/login', { username, password }),
    logout: () => post('/auth/logout'),
    changePassword: (current: string, next: string) => post('/auth/password', { current, next }),
    users: async () => {
      const result = await get<{ users: { id: number; username: string; role: 'admin' | 'user'; created_at: number }[] }>('/auth/users');
      return result.users.map<ManagedUser>((user) => ({
        id: user.id,
        username: user.username,
        role: user.role,
        createdAt: user.created_at,
      }));
    },
    createUser: (username: string, password: string, role: string) => post('/auth/users', { username, password, role }),
    deleteUser: (id: number) => request(`/auth/users/${id}`, { method: 'DELETE' }),
  },
  home: () => get<HomeData>('/home'),
  tracks: (sort = 'added', limit = 100, offset = 0) =>
    get<{ tracks: Track[]; total: number }>(`/tracks?sort=${sort}&limit=${limit}&offset=${offset}`),
  albums: (sort = 'added', limit = 200, offset = 0) => get<{ albums: Album[] }>(`/albums?sort=${sort}&limit=${limit}&offset=${offset}`),
  album: (id: number) => get<{ album: Album; tracks: Track[]; moreByArtist: Album[] }>(`/albums/${id}`),
  artists: () => get<{ artists: Artist[] }>('/artists?limit=500'),
  artist: (id: number) => get<{ artist: Artist; albums: Album[]; tracks: Track[] }>(`/artists/${id}`),
  artistTracks: (id: number) => get<{ artist: Artist; tracks: Track[] }>(`/artists/${id}/tracks`),
  search: (q: string, signal?: AbortSignal) =>
    request<{ tracks: Track[]; albums: Album[]; artists: Artist[] }>(`/search?q=${encodeURIComponent(q)}`, { signal }),
  lyrics: (id: number) => get<{ lyrics: Lyrics | null }>(`/tracks/${id}/lyrics`),
  managedTracks: (visibility: 'all' | 'visible' | 'hidden', q = '', limit = 100, offset = 0) =>
    get<{ tracks: ManagedTrack[]; hasMore: boolean; stats: ManagedTrackStats | null }>(
      `/admin/tracks?visibility=${visibility}&q=${encodeURIComponent(q)}&limit=${limit}&offset=${offset}`,
    ),
  setTrackVisibility: (id: number, visible: boolean) =>
    request<{ id: number; visible: boolean }>(`/admin/tracks/${id}/visibility`, { method: 'PATCH', json: { visible } }),

  favorites: () => get<{ tracks: Track[] }>('/me/favorites'),
  like: (id: number) => request<{ liked: boolean }>(`/me/favorites/${id}`, { method: 'PUT' }),
  unlike: (id: number) => request<{ liked: boolean }>(`/me/favorites/${id}`, { method: 'DELETE' }),
  history: (trackId: number) => post('/me/history', { trackId }),

  playlists: () => get<{ playlists: Playlist[] }>('/me/playlists'),
  playlist: (id: number) => get<{ playlist: Omit<Playlist, 'trackCount' | 'duration' | 'artworkId' | 'trackIds'>; tracks: Track[] }>(`/me/playlists/${id}`),
  createPlaylist: (name: string, trackIds?: number[]) => post<{ id: number; name: string }>('/me/playlists', { name, trackIds }),
  updatePlaylist: (id: number, data: { name?: string; description?: string }) =>
    request(`/me/playlists/${id}`, { method: 'PATCH', json: data }),
  deletePlaylist: (id: number) => request(`/me/playlists/${id}`, { method: 'DELETE' }),
  addToPlaylist: (id: number, trackIds: number[]) => post(`/me/playlists/${id}/tracks`, { trackIds }),
  removeFromPlaylist: (id: number, entryId: number) => request(`/me/playlists/${id}/tracks/${entryId}`, { method: 'DELETE' }),

  sync: {
    status: () => get<SyncStatus>('/sync/status'),
    ping: () => get<{ ok: boolean; root: string; entries: number }>('/sync/ping'),
    list: (dir: string | undefined, scanId: string) => post<{ dir: string; dirs: string[]; audioFiles: number; skippedOversizedCover: string | null }>('/sync/list', { dir, scanId }),
    process: (limit = 4) =>
      post<{ processed: { id: number; title: string; error?: string }[]; hasMore: boolean }>('/sync/process', { limit }),
    finalize: (scanId: string, dir?: string) => post<{ removed: number }>('/sync/finalize', { scanId, dir }),
    reset: (scope: 'errors' | 'all') => post<{ reset: number }>('/sync/reset', { scope }),
  },
};
