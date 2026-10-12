import type { Track } from '../api/types';

export function formatTime(sec: number | null | undefined): string {
  if (!sec || !Number.isFinite(sec) || sec < 0) return '0:00';
  const s = Math.floor(sec);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const r = String(s % 60).padStart(2, '0');
  return h ? `${h}:${String(m).padStart(2, '0')}:${r}` : `${m}:${r}`;
}

export function formatLongDuration(sec: number): string {
  const h = Math.floor(sec / 3600);
  const m = Math.round((sec % 3600) / 60);
  if (h) return `${h} 小時 ${m} 分鐘`;
  return `${m} 分鐘`;
}

export const LOSSLESS = new Set(['flac', 'alac', 'wav']);
export const DOLBY_ATMOS = new Set(['ec-3', 'eac3', 'e-ac-3']);

export const isLossless = (t: Pick<Track, 'codec'>) => !!t.codec && LOSSLESS.has(t.codec);
export const isDolbyAtmos = (t: Pick<Track, 'codec'>) => !!t.codec && DOLBY_ATMOS.has(t.codec.toLowerCase());
export const isHiRes = (t: Pick<Track, 'codec' | 'bitDepth' | 'sampleRate'>) =>
  isLossless(t) && ((t.bitDepth ?? 16) > 16 || (t.sampleRate ?? 44100) > 48000);

/** The concise text badge used for non-Atmos lossless tracks. */
export function qualityLabel(t: Pick<Track, 'codec' | 'bitDepth' | 'sampleRate'>): 'HI-RES' | 'LOSSLESS' | null {
  if (isDolbyAtmos(t)) return null;
  if (isHiRes(t)) return 'HI-RES';
  if (isLossless(t)) return 'LOSSLESS';
  return null;
}

export function shuffleArray<T>(arr: T[]): T[] {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}
