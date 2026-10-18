import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { api, artUrl, streamUrl } from '../api/client';
import type { Track } from '../api/types';
import { shuffleArray } from '../lib/format';
import { requireLogin } from '../lib/login-gate';

export type RepeatMode = 'off' | 'all' | 'one';

interface PlayerState {
  sessionOwnerId: number | null;
  queue: Track[];
  index: number;
  originalQueue: Track[] | null;
  isPlaying: boolean;
  isBuffering: boolean;
  currentTime: number;
  duration: number;
  bufferedEnd: number;
  volume: number;
  muted: boolean;
  shuffle: boolean;
  repeat: RepeatMode;
  error: string | null;
  nowPlayingOpen: boolean;
  queueOpen: boolean;

  playList: (tracks: Track[], start?: number, opts?: { shuffle?: boolean }) => void;
  playNext: (tracks: Track[]) => void;
  addToQueue: (tracks: Track[]) => void;
  removeFromQueue: (i: number) => void;
  jumpTo: (i: number) => void;
  toggle: () => void;
  next: () => void;
  prev: () => void;
  seek: (t: number) => void;
  setVolume: (v: number) => void;
  toggleMute: () => void;
  toggleShuffle: () => void;
  cycleRepeat: () => void;
  setNowPlaying: (open: boolean) => void;
  setQueueOpen: (open: boolean) => void;
  resetForSession: (userId: number | null) => void;
}

/** One audio element for the whole app lives outside React. */
const audio = typeof Audio !== 'undefined' ? new Audio() : (null as unknown as HTMLAudioElement);
if (audio) {
  audio.preload = 'auto';
}
export const getAudio = () => audio;

let reportedFor: number | null = null;
let pendingSeek: number | null = null;

export const usePlayer = create<PlayerState>()(
  persist(
    (set, get) => {
      const current = () => get().queue[get().index];

      function load(index: number, autoplay: boolean) {
        const track = get().queue[index];
        if (!track) return;
        set({ index, currentTime: 0, duration: track.duration || 0, bufferedEnd: 0, error: null });
        reportedFor = null;
        audio.src = streamUrl(track.id);
        if (autoplay) {
          set({ isBuffering: true });
          audio.play().catch((e) => {
            if (e?.name !== 'AbortError') set({ isPlaying: false, isBuffering: false });
          });
        }
        updateMediaSession(track);
      }

      return {
        sessionOwnerId: null,
        queue: [],
        index: 0,
        originalQueue: null,
        isPlaying: false,
        isBuffering: false,
        currentTime: 0,
        duration: 0,
        bufferedEnd: 0,
        volume: 0.8,
        muted: false,
        shuffle: false,
        repeat: 'off',
        error: null,
        nowPlayingOpen: false,
        queueOpen: false,

        playList(tracks, start = 0, opts) {
          if (!tracks.length || !requireLogin()) return;
          const wantShuffle = opts?.shuffle ?? get().shuffle;
          if (wantShuffle) {
            const first = tracks[start];
            const rest = shuffleArray(tracks.filter((_, i) => i !== start));
            const shuffled = opts?.shuffle && start === 0 ? shuffleArray(tracks) : [first, ...rest];
            set({ queue: shuffled, originalQueue: tracks, shuffle: true });
            load(0, true);
          } else {
            set({ queue: tracks, originalQueue: null });
            load(start, true);
          }
        },

        playNext(tracks) {
          if (!requireLogin()) return;
          const { queue, index } = get();
          if (!queue.length) return get().playList(tracks);
          set({ queue: [...queue.slice(0, index + 1), ...tracks, ...queue.slice(index + 1)] });
        },

        addToQueue(tracks) {
          if (!requireLogin()) return;
          if (!get().queue.length) return get().playList(tracks);
          set({ queue: [...get().queue, ...tracks] });
        },

        removeFromQueue(i) {
          const { queue, index } = get();
          if (i === index) return;
          set({ queue: queue.filter((_, j) => j !== i), index: i < index ? index - 1 : index });
        },

        jumpTo(i) {
          if (!requireLogin()) return;
          load(i, true);
        },

        toggle() {
          if (!current() || !requireLogin()) return;
          if (!audio.src) return load(get().index, true);
          if (audio.paused) audio.play().catch(() => {});
          else audio.pause();
        },

        next() {
          const { queue, index, repeat } = get();
          if (index + 1 < queue.length) load(index + 1, true);
          else if (repeat === 'all' && queue.length) load(0, true);
        },

        prev() {
          if (audio.currentTime > 3) {
            audio.currentTime = 0;
            return;
          }
          const { index, queue, repeat } = get();
          if (index > 0) load(index - 1, true);
          else if (repeat === 'all' && queue.length) load(queue.length - 1, true);
          else audio.currentTime = 0;
        },

        seek(t) {
          if (!audio.src) {
            pendingSeek = t;
            return load(get().index, true);
          }
          audio.currentTime = t;
          set({ currentTime: t });
        },

        setVolume(v) {
          const volume = Math.min(1, Math.max(0, v));
          audio.volume = volume;
          audio.muted = false;
          set({ volume, muted: false });
        },

        toggleMute() {
          audio.muted = !get().muted;
          set({ muted: !get().muted });
        },

        toggleShuffle() {
          const { shuffle, queue, index, originalQueue } = get();
          const cur = queue[index];
          if (!shuffle) {
            const rest = shuffleArray(queue.filter((_, i) => i !== index));
            set({ shuffle: true, originalQueue: queue, queue: cur ? [cur, ...rest] : rest, index: 0 });
          } else {
            const base = originalQueue ?? queue;
            const at = cur ? base.findIndex((t) => t.id === cur.id) : 0;
            set({ shuffle: false, originalQueue: null, queue: base, index: Math.max(0, at) });
          }
        },

        cycleRepeat() {
          const order: RepeatMode[] = ['off', 'all', 'one'];
          set({ repeat: order[(order.indexOf(get().repeat) + 1) % 3] });
        },

        setNowPlaying: (open) => set({ nowPlayingOpen: open, queueOpen: false }),
        setQueueOpen: (open) => set({ queueOpen: open }),
        resetForSession(userId) {
          const state = get();
          if (state.sessionOwnerId === userId && !(userId === null && state.queue.length)) return;

          reportedFor = null;
          pendingSeek = null;
          audio.pause();
          audio.removeAttribute('src');
          audio.load();
          if ('mediaSession' in navigator) navigator.mediaSession.metadata = null;
          set({
            sessionOwnerId: userId,
            queue: [],
            index: 0,
            originalQueue: null,
            isPlaying: false,
            isBuffering: false,
            currentTime: 0,
            duration: 0,
            bufferedEnd: 0,
            error: null,
            nowPlayingOpen: false,
            queueOpen: false,
          });
        },
      };
    },
    {
      name: 'ascooo-player',
      partialize: (s) => ({
        sessionOwnerId: s.sessionOwnerId,
        queue: s.queue.slice(0, 500),
        index: s.index,
        originalQueue: s.originalQueue?.slice(0, 500) ?? null,
        volume: s.volume,
        muted: s.muted,
        shuffle: s.shuffle,
        repeat: s.repeat,
      }),
      onRehydrateStorage: () => (state) => {
        if (!state || !audio) return;
        audio.volume = state.volume;
        audio.muted = state.muted;
        const t = state.queue[state.index];
        if (t) {
          // Keep the queue between visits, but always start the track from the beginning.
          usePlayer.setState({ currentTime: 0, duration: t.duration, isPlaying: false });
          updateMediaSession(t);
        }
      },
    },
  ),
);

// ---------- audio element → store ----------

if (audio) {
  const s = usePlayer.setState;
  let lastTick = 0;

  audio.addEventListener('play', () => s({ isPlaying: true }));
  audio.addEventListener('pause', () => s({ isPlaying: false }));
  audio.addEventListener('waiting', () => s({ isBuffering: true }));
  audio.addEventListener('playing', () => s({ isBuffering: false, isPlaying: true }));
  audio.addEventListener('canplay', () => s({ isBuffering: false }));
  audio.addEventListener('loadedmetadata', () => {
    if (Number.isFinite(audio.duration)) s({ duration: audio.duration });
    if (pendingSeek != null) {
      audio.currentTime = pendingSeek;
      pendingSeek = null;
    }
  });
  audio.addEventListener('timeupdate', () => {
    const now = performance.now();
    if (now - lastTick < 250) return;
    lastTick = now;
    const t = audio.currentTime;
    const b = audio.buffered;
    s({ currentTime: t, bufferedEnd: b.length ? b.end(b.length - 1) : 0 });

    const track = usePlayer.getState().queue[usePlayer.getState().index];
    if (track && reportedFor !== track.id && t > Math.min(30, (track.duration || 60) / 2)) {
      reportedFor = track.id;
      api.history(track.id).catch(() => {});
    }
    if ('mediaSession' in navigator && Number.isFinite(audio.duration)) {
      try {
        navigator.mediaSession.setPositionState({ duration: audio.duration, position: t, playbackRate: audio.playbackRate });
      } catch {
        /* ignore */
      }
    }
  });
  audio.addEventListener('ended', () => {
    const { repeat } = usePlayer.getState();
    if (repeat === 'one') {
      audio.currentTime = 0;
      audio.play().catch(() => {});
    } else {
      const { queue, index } = usePlayer.getState();
      if (index + 1 < queue.length || repeat === 'all') usePlayer.getState().next();
      else s({ isPlaying: false });
    }
  });
  audio.addEventListener('error', () => {
    const code = audio.error?.code;
    const track = usePlayer.getState().queue[usePlayer.getState().index];
    const msg =
      code === 4
        ? `瀏覽器無法播放此格式${track?.codec === 'alac' ? '（ALAC 僅 Safari 支援）' : ''}`
        : '無法從 PikPak 載入音訊，請稍後再試';
    s({ isPlaying: false, isBuffering: false, error: msg });
  });

  if ('mediaSession' in navigator) {
    const ms = navigator.mediaSession;
    const g = () => usePlayer.getState();
    ms.setActionHandler('play', () => g().toggle());
    ms.setActionHandler('pause', () => audio.pause());
    ms.setActionHandler('previoustrack', () => g().prev());
    ms.setActionHandler('nexttrack', () => g().next());
    ms.setActionHandler('seekto', (d) => d.seekTime != null && g().seek(d.seekTime));
  }

}

function updateMediaSession(t: Track) {
  if (!('mediaSession' in navigator)) return;
  // Offer only the 2000px variant: WebKit scores candidates against a 512px ideal
  // and would otherwise pick the 512 version, which looks blurry on the lock screen.
  const art = artUrl(t.artworkId, 2000);
  const artwork = art
    ? [{ src: new URL(art, location.origin).toString(), sizes: '2000x2000', type: 'image/webp' }]
    : [];
  navigator.mediaSession.metadata = new MediaMetadata({
    title: t.title,
    artist: t.artist,
    album: t.album,
    artwork,
  });
}

export const useCurrentTrack = () => usePlayer((s) => s.queue[s.index] as Track | undefined);
