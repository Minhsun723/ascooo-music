import { create } from 'zustand';
import { api } from '../api/client';
import type { Playlist, User } from '../api/types';

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

export const useSession = create<SessionState>((set, get) => ({
  ready: false,
  needsSetup: false,
  user: null,
  playlists: [],
  async init() {
    try {
      const s = await api.auth.status();
      set({ ready: true, needsSetup: s.needsSetup, user: s.user });
      if (s.user) get().refreshPlaylists();
    } catch {
      set({ ready: true, user: null });
    }
  },
  setUser(user) {
    set({ user, needsSetup: false });
    if (user) get().refreshPlaylists();
  },
  async logout() {
    await api.auth.logout().catch(() => {});
    set({ user: null, playlists: [] });
  },
  async refreshPlaylists() {
    try {
      const { playlists } = await api.playlists();
      set({ playlists });
    } catch {
      /* ignore */
    }
  },
}));
