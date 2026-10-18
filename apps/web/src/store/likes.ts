import { create } from 'zustand';
import { api } from '../api/client';
import { requireLogin } from '../lib/login-gate';
import type { Track } from '../api/types';
import { toast } from './toast';

interface LikesState {
  epoch: number;
  overrides: Record<number, boolean>;
  toggle: (t: Pick<Track, 'id' | 'liked'>) => Promise<void>;
  reset: () => void;
}

/** Optimistic like state shared by every list, the player bar and now-playing. */
export const useLikes = create<LikesState>((set, get) => ({
  epoch: 0,
  overrides: {},
  async toggle(t) {
    if (!requireLogin()) return;
    const epoch = get().epoch;
    const was = get().overrides[t.id] ?? t.liked;
    set({ overrides: { ...get().overrides, [t.id]: !was } });
    try {
      await (was ? api.unlike(t.id) : api.like(t.id));
      if (get().epoch !== epoch) return;
      toast(was ? '已從喜愛的歌曲移除' : '已加入喜愛的歌曲');
    } catch (e) {
      if (get().epoch !== epoch) return;
      set({ overrides: { ...get().overrides, [t.id]: was } });
      toast((e as Error).message, 'error');
    }
  },
  reset() {
    set({ epoch: get().epoch + 1, overrides: {} });
  },
}));

export const useIsLiked = (t: Pick<Track, 'id' | 'liked'> | undefined) =>
  useLikes((s) => (t ? (s.overrides[t.id] ?? t.liked) : false));
