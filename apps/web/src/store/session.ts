import { create } from 'zustand';
import { api } from '../api/client';
import type { Playlist, User } from '../api/types';
import { useLikes } from './likes';
import { usePlayer } from './player';
import { useToasts } from './toast';

interface SessionState {
  ready: boolean;
  needsSetup: boolean;
  user: User | null;
  playlists: Playlist[];
  init: () => Promise<void>;
  setUser: (u: User | null) => void;
  logout: () => Promise<void>;
  refreshPlaylists: () => Promise<void>;
}

function resetClientState(userId: number | null) {
  useLikes.getState().reset();
  useToasts.setState({ toasts: [] });
  usePlayer.getState().resetForSession(userId);
}

export const useSession = create<SessionState>((set, get) => ({
  ready: false,
  needsSetup: false,
  user: null,
  playlists: [],
  async init() {
    try {
      const s = await api.auth.status();
      resetClientState(s.user?.id ?? null);
      set({ ready: true, needsSetup: s.needsSetup, user: s.user, playlists: [] });
      if (s.user) get().refreshPlaylists();
    } catch {
      resetClientState(null);
      set({ ready: true, user: null, playlists: [] });
    }
  },
  setUser(user) {
    const previousUserId = get().user?.id ?? null;
    const nextUserId = user?.id ?? null;
    if (previousUserId !== nextUserId) resetClientState(nextUserId);
    set({ user, needsSetup: false, playlists: previousUserId === nextUserId ? get().playlists : [] });
    if (user) get().refreshPlaylists();
  },
  async logout() {
    const request = api.auth.logout().catch(() => {});
    get().setUser(null);
    await request;
  },
  async refreshPlaylists() {
    const userId = get().user?.id;
    if (!userId) return;
    try {
      const { playlists } = await api.playlists();
      if (get().user?.id === userId) set({ playlists });
    } catch {
      /* ignore */
    }
  },
}));
