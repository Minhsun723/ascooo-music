import { create } from 'zustand';
import { api } from '../api/client';
import type { Track } from '../api/types';
import { toast } from './toast';

interface LikesState {
  overrides: Record<number, boolean>;
  toggle: (t: Pick<Track, 'id' | 'liked'>) => Promise<void>;
}

/** Optimistic like state shared by every list, the player bar and now-playing. */
export const useLikes = create<LikesState>((set, get) => ({
  overrides: {},
  async toggle(t) {
    const was = get().overrides[t.id] ?? t.liked;
    set({ overrides: { ...get().overrides, [t.id]: !was } });
    try {
      await (was ? api.unlike(t.id) : api.like(t.id));
      toast(was ? '已從喜愛的歌曲移除' : '已加入喜愛的歌曲');
    } catch (e) {
      set({ overrides: { ...get().overrides, [t.id]: was } });
      toast((e as Error).message, 'error');
    }
  },
}));

export const useIsLiked = (t: Pick<Track, 'id' | 'liked'> | undefined) =>
  useLikes((s) => (t ? (s.overrides[t.id] ?? t.liked) : false));
