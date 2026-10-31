import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { api, artUrl, streamUrl, type AudioSource } from '../api/client';
import type { Track } from '../api/types';
import { isDolbyAtmos, shuffleArray } from '../lib/format';
import { requireLogin } from '../lib/login-gate';
import { usePreferences } from './preferences';

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
  /** The file actually streaming for the current track. */
  source: AudioSource;
  nowPlayingOpen: boolean;
  /** The open player is being dragged down, uncovering the page beneath it. */
  nowPlayingPulled: boolean;
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
  setNowPlayingPulled: (pulled: boolean) => void;
  setQueueOpen: (open: boolean) => void;
  resetForSession: (userId: number | null) => void;
}

/** One audio element for the whole app lives outside React. */
const audio = typeof Audio !== 'undefined' ? new Audio() : (null as unknown as HTMLAudioElement);
if (audio) {
  audio.preload = 'auto';
}
export const getAudio = () => audio;

// Some browsers (Chrome on Android especially) advance currentTime in 20–100ms steps, so anything
// animated straight off it stutters. Between steps the playhead is extrapolated from the wall clock,
// and each new reading only nudges the estimate, so the result moves every frame and never backwards.
// After a seek the output can sit still for a few hundred ms while it restarts, so extrapolation
// waits until the reported time actually moves, and never runs further ahead than MAX_EXTRAPOLATE:
// kept below MAX_DRIFT, a stall can only pause the estimate, never make it snap back.
const MAX_DRIFT = 0.3; // seconds off the reported time that count as a jump (seek, loop)
const MAX_EXTRAPOLATE = 0.2;
const DRIFT_CORRECTION = 0.3;
let clockRaw = Number.NaN;
let clockBase = 0;
let clockAt = 0;
let clockLast = 0;
let clockLive = false; // the reported time has advanced since the last jump

function resetClock(raw: number, now: number) {
  clockRaw = raw;
  clockBase = raw;
  clockAt = now;
  clockLast = raw;
  clockLive = false;
}

/** Smoothed playhead for frame-by-frame animation; use audio.currentTime for anything else. */
export function getPlaybackTime() {
  if (!audio) return 0;
  const raw = audio.currentTime;
  const now = performance.now();
  if (audio.paused || audio.seeking || audio.readyState < HTMLMediaElement.HAVE_FUTURE_DATA) {
    resetClock(raw, now);
    return raw;
  }
  const rate = audio.playbackRate;
  const project = () => Math.min(clockBase + (now - clockAt) / 1000 * rate, clockRaw + MAX_EXTRAPOLATE);
  if (raw !== clockRaw) {
    const drift = raw - (clockLive ? project() : clockRaw);
    if (Number.isNaN(clockRaw) || Math.abs(drift) > MAX_DRIFT) {
      resetClock(raw, now);
    } else if (!clockLive) {
      // First movement after a jump: start extrapolating from here.
      clockRaw = raw;
      clockBase = raw;
      clockAt = now;
      clockLive = true;
    } else {
      clockBase = project() + drift * DRIFT_CORRECTION;
      clockRaw = raw;
      clockAt = now;
    }
  }
  if (clockLive) clockLast = Math.max(clockLast, project());
  return clockLast;
}

/** Safari and some Edge/Android builds decode EC-3; Chrome and Firefox on desktop do not. */
export const canPlayAtmos = !!audio && audio.canPlayType('audio/mp4; codecs="ec-3"') !== '';

function pickSource(track: Track): AudioSource {
  if (!track.hasAac51) return 'original';
  const format = usePreferences.getState().surroundFormat;
  if (format === 'aac51') return 'aac51';
  // A forced Atmos choice saved on this device acts as auto once EC-3 is unavailable.
  if (format === 'atmos' && canPlayAtmos) return 'original';
  return isDolbyAtmos(track) && !canPlayAtmos ? 'aac51' : 'original';
}

let reportedFor: number | null = null;
let pendingSeek: number | null = null;

// Near the end of a track, one byte of the next stream is requested so the Worker resolves
// its PikPak link while this one still plays. The change of track then skips that round-trip,
// which matters most on iOS: a page in the background is suspended soon after it goes silent.
const WARM_AHEAD = 30; // seconds before the end
let warmedUrl: string | null = null;

export const usePlayer = create<PlayerState>()(
  persist(
    (set, get) => {
      const current = () => get().queue[get().index];

      function load(index: number, autoplay: boolean) {
        const track = get().queue[index];
        if (!track) return;
        const source = pickSource(track);
        set({ index, currentTime: 0, duration: track.duration || 0, bufferedEnd: 0, error: null, source });
        reportedFor = null;
        pendingSeek = null;
        warmedUrl = null;
        audio.src = streamUrl(track.id, source);
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
        source: 'original',
        nowPlayingOpen: false,
        nowPlayingPulled: false,
        queueOpen: false,

        playList(tracks, start = 0, opts) {
          if (!tracks.length || !requireLogin({ track: tracks[start] })) return;
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
          if (!requireLogin({ track: tracks[0] })) return;
          const { queue, index } = get();
          if (!queue.length) return get().playList(tracks);
          set({ queue: [...queue.slice(0, index + 1), ...tracks, ...queue.slice(index + 1)] });
        },

        addToQueue(tracks) {
          if (!requireLogin({ track: tracks[0] })) return;
          if (!get().queue.length) return get().playList(tracks);
          set({ queue: [...get().queue, ...tracks] });
        },

        removeFromQueue(i) {
          const { queue, index } = get();
          if (i === index) return;
          set({ queue: queue.filter((_, j) => j !== i), index: i < index ? index - 1 : index });
        },

        jumpTo(i) {
          if (!requireLogin({ track: get().queue[i] })) return;
          load(i, true);
        },

        toggle() {
          const track = current();
          if (!track || !requireLogin({ track })) return;
          if (!audio.src) return load(get().index, true);
          // A failed element won't fetch again on play(), so reload the track where it stopped.
          if (audio.error) {
            const at = audio.currentTime;
            load(get().index, true);
            if (at > 0) get().seek(at);
            return;
          }
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
          if (!audio.src) load(get().index, true);
          // Until metadata arrives the element can't seek, so keep only the latest position
          // (a scrub sends many) for loadedmetadata to apply.
          if (audio.readyState < audio.HAVE_METADATA) {
            pendingSeek = t;
            set({ currentTime: t });
            return;
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

        setNowPlaying: (open) => set({ nowPlayingOpen: open, nowPlayingPulled: false, queueOpen: false }),
        setNowPlayingPulled: (pulled) => set({ nowPlayingPulled: pulled }),
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
            source: 'original',
            nowPlayingOpen: false,
            nowPlayingPulled: false,
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

/** Swap the file behind the current track without losing its position or play state. */
function switchSource(source: AudioSource) {
  const { queue, index, currentTime, isPlaying, isBuffering } = usePlayer.getState();
  const track = queue[index];
  if (!track) return;
  const resume = !audio.paused || isPlaying || isBuffering;
  pendingSeek = audio.currentTime || currentTime;
  usePlayer.setState({ source, error: null, isBuffering: resume });
  audio.src = streamUrl(track.id, source);
  if (resume) {
    audio.play().catch((e) => {
      if (e?.name !== 'AbortError') usePlayer.setState({ isPlaying: false, isBuffering: false });
    });
  }
}

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
    // A seek waiting on metadata owns the playhead; the element still reports 0 until it lands.
    if (pendingSeek != null || now - lastTick < 250) return;
    lastTick = now;
    const t = audio.currentTime;
    const b = audio.buffered;
    s({ currentTime: t, bufferedEnd: b.length ? b.end(b.length - 1) : 0 });

    const { queue, index, repeat } = usePlayer.getState();
    const track = queue[index];
    if (track && reportedFor !== track.id && t > Math.min(30, (track.duration || 60) / 2)) {
      reportedFor = track.id;
      api.history(track.id).catch(() => {});
    }
    const total = Number.isFinite(audio.duration) ? audio.duration : track?.duration || 0;
    if (total && total - t < WARM_AHEAD && repeat !== 'one') {
      const upcoming = index + 1 < queue.length ? queue[index + 1] : repeat === 'all' ? queue[0] : undefined;
      const url = upcoming ? streamUrl(upcoming.id, pickSource(upcoming)) : null;
      // Compared each tick, so a queue or setting change before the end warms the new pick.
      if (url && url !== warmedUrl) {
        warmedUrl = url;
        fetch(url, { headers: { Range: 'bytes=0-0' } }).then((res) => res.body?.cancel()).catch(() => {});
      }
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
    const { queue, index, source } = usePlayer.getState();
    const track = queue[index];
    // canPlayType can promise EC-3 support that decoding then fails to deliver.
    if ((code === 3 || code === 4) && source === 'original' && track?.hasAac51 &&
        isDolbyAtmos(track) && !(usePreferences.getState().surroundFormat === 'atmos' && canPlayAtmos)) {
      switchSource('aac51');
      return;
    }
    s({ isPlaying: false, isBuffering: false });
    // Chrome reports any failure before metadata, an HTTP error included, as an unsupported
    // source, so it is a format problem only when the stream itself answers.
    const src = audio.src;
    const answered = code === 4
      ? fetch(src, { headers: { Range: 'bytes=0-0' } }).then((res) => {
          res.body?.cancel().catch(() => {});
          return res.ok;
        }, () => false)
      : Promise.resolve(false);
    void answered.then((ok) => {
      if (audio.src !== src || !audio.error) return;
      s({
        error: ok
          ? `瀏覽器無法播放此格式${track?.codec === 'alac' ? '（ALAC 僅 Safari 支援）' : ''}`
          : '暫時無法載入音訊，請稍後再試',
      });
    });
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

  // Changing the surround setting takes effect on the track already playing.
  usePreferences.subscribe((prefs, previous) => {
    if (prefs.surroundFormat === previous.surroundFormat || !audio.src) return;
    const { queue, index, source } = usePlayer.getState();
    const track = queue[index];
    if (!track) return;
    const wanted = pickSource(track);
    if (wanted !== source) switchSource(wanted);
  });
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
