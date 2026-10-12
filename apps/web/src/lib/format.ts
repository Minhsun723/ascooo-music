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

export function formatBytes(bytes: number): string {
  if (bytes >= 1e12) return `${(bytes / 1e12).toFixed(1)} TB`;
  if (bytes >= 1e9) return `${(bytes / 1e9).toFixed(1)} GB`;
  return `${Math.round(bytes / 1e6)} MB`;
}

export const LOSSLESS = new Set(['flac', 'alac', 'wav']);
export const DOLBY_ATMOS = new Set(['ec-3', 'eac3', 'e-ac-3']);

export const isLossless = (t: Pick<Track, 'codec'>) => !!t.codec && LOSSLESS.has(t.codec);
export const isDolbyAtmos = (t: Pick<Track, 'codec'>) => !!t.codec && DOLBY_ATMOS.has(t.codec.toLowerCase());
export const isHiRes = (t: Pick<Track, 'codec' | 'bitDepth' | 'sampleRate'>) =>
  isLossless(t) && ((t.bitDepth ?? 16) > 16 || (t.sampleRate ?? 44100) > 48000);

/** "FLAC · 24-bit · 96 kHz" — the readout shown next to the playing song. */
export function qualityParts(t: Pick<Track, 'codec' | 'bitDepth' | 'sampleRate' | 'bitrate'>): string[] {
  const parts: string[] = [];
  if (t.codec) parts.push(t.codec.toUpperCase());
  if (isLossless(t) && t.bitDepth) parts.push(`${t.bitDepth}-bit`);
  if (t.sampleRate) parts.push(`${+(t.sampleRate / 1000).toFixed(1)} kHz`);
  if (!isLossless(t) && t.bitrate) parts.push(`${t.bitrate} kbps`);
  return parts;
}

export function greeting(now = new Date()): string {
  const h = now.getHours();
  if (h < 5) return '夜深了';
  if (h < 11) return '早安';
  if (h < 14) return '午安';
  if (h < 18) return '下午好';
  return '晚安';
}

export function shuffleArray<T>(arr: T[]): T[] {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}
