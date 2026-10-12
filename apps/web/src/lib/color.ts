/**
 * Extract a vivid accent and a deep backdrop tone from artwork. Art is served
 * from our own origin, so the canvas is never tainted.
 */
export interface Palette {
  accent: string; // vivid, readable on dark
  deep: string; // dark tone for backgrounds
  glow: string; // rgba for ambient light
}

export const DEFAULT_PALETTE: Palette = {
  accent: 'hsl(39 88% 62%)',
  deep: 'hsl(265 18% 9%)',
  glow: 'hsla(28 85% 55% / 0.35)',
};

const cache = new Map<string, Palette>();

function rgbToHsl(r: number, g: number, b: number): [number, number, number] {
  r /= 255;
  g /= 255;
  b /= 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  if (max === min) return [0, 0, l];
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h = 0;
  if (max === r) h = (g - b) / d + (g < b ? 6 : 0);
  else if (max === g) h = (b - r) / d + 2;
  else h = (r - g) / d + 4;
  return [h * 60, s, l];
}

export function extractPalette(src: string): Promise<Palette> {
  const hit = cache.get(src);
  if (hit) return Promise.resolve(hit);

  return new Promise((resolve) => {
    const img = new Image();
    img.decoding = 'async';
    img.onload = () => {
      try {
        const size = 32;
        const canvas = document.createElement('canvas');
        canvas.width = canvas.height = size;
        const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
        ctx.drawImage(img, 0, 0, size, size);
        const { data } = ctx.getImageData(0, 0, size, size);

        // Hue histogram weighted by saturation, so muddy pixels don't win.
        const bins = new Array(36).fill(0).map(() => ({ w: 0, s: 0, l: 0 }));
        let avgL = 0;
        for (let i = 0; i < data.length; i += 4) {
          const [h, s, l] = rgbToHsl(data[i], data[i + 1], data[i + 2]);
          avgL += l;
          if (l < 0.08 || l > 0.95) continue;
          const w = s * s * (1 - Math.abs(l - 0.5));
          const bin = bins[Math.floor(h / 10) % 36];
          bin.w += w;
          bin.s += s * w;
          bin.l += l * w;
        }
        avgL /= data.length / 4;
        let best = 0;
        for (let i = 1; i < 36; i++) if (bins[i].w > bins[best].w) best = i;
        const b = bins[best];

        let palette: Palette;
        if (b.w < 0.5) {
          // Near-monochrome cover: keep it neutral but not dead.
          palette = {
            accent: `hsl(40 12% ${avgL > 0.5 ? 82 : 76}%)`,
            deep: 'hsl(250 6% 9%)',
            glow: 'hsla(40 10% 70% / 0.18)',
          };
        } else {
          const hue = best * 10 + 5;
          const sat = Math.min(0.9, Math.max(0.45, b.s / b.w));
          palette = {
            accent: `hsl(${hue} ${Math.round(sat * 100)}% 66%)`,
            deep: `hsl(${hue} ${Math.round(sat * 45)}% 10%)`,
            glow: `hsla(${hue} ${Math.round(sat * 100)}% 52% / 0.42)`,
          };
        }
        cache.set(src, palette);
        resolve(palette);
      } catch {
        resolve(DEFAULT_PALETTE);
      }
    };
    img.onerror = () => resolve(DEFAULT_PALETTE);
    img.src = src;
  });
}
