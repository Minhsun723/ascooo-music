import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export type LyricsFont = 'sans' | 'serif' | 'wenkai' | 'decol';

export const LYRICS_FONTS: { value: LyricsFont; label: string; sample: string }[] = [
  { value: 'sans', label: 'Noto Sans', sample: '歌詞預覽 うた Aa' },
  { value: 'serif', label: 'Noto Serif', sample: '歌詞預覽 うた Aa' },
  { value: 'wenkai', label: 'LXGW WenKai Mono', sample: '歌詞預覽 うた Aa' },
  { value: 'decol', label: 'Kaisei Decol', sample: '歌詞預覽 うた Aa' },
];

interface PreferencesState {
  lyricsFont: LyricsFont;
  setLyricsFont: (font: LyricsFont) => void;
}

export const usePreferences = create<PreferencesState>()(
  persist(
    (set) => ({
      lyricsFont: 'sans',
      setLyricsFont: (lyricsFont) => set({ lyricsFont }),
    }),
    { name: 'ascooo-preferences' },
  ),
);

// Mirror onto <html> so the stylesheet can switch the lyrics font everywhere.
const applyLyricsFont = (font: LyricsFont) => { document.documentElement.dataset.lyricsFont = font; };
applyLyricsFont(usePreferences.getState().lyricsFont);
usePreferences.subscribe((state) => applyLyricsFont(state.lyricsFont));
