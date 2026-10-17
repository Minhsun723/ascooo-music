import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export type LyricsFont = 'sans' | 'serif' | 'wenkai' | 'decol';

export const LYRICS_FONTS: { value: LyricsFont; label: string; sample: string }[] = [
  { value: 'sans', label: 'Noto Sans', sample: '歌詞預覽 うた Aa' },
  { value: 'serif', label: 'Noto Serif', sample: '歌詞預覽 うた Aa' },
  { value: 'wenkai', label: 'LXGW WenKai Mono', sample: '歌詞預覽 うた Aa' },
  { value: 'decol', label: 'Kaisei Decol', sample: '歌詞預覽 うた Aa' },
];

export type LyricsMode = 'scroll' | 'immersive';

export const LYRICS_MODES: { value: LyricsMode; label: string }[] = [
  { value: 'scroll', label: '捲動' },
  { value: 'immersive', label: '沉浸式' },
];

export type ImmersiveStyle =
  | 'scatter' | 'calm' | 'depth' | 'bounce' | 'mist' | 'marker' | 'flip' | 'slam' | 'neon'
  | 'partita' | 'tilt' | 'claddagh' | 'cappella';

export const IMMERSIVE_STYLES: { value: ImmersiveStyle; label: string; description: string }[] = [
  { value: 'scatter', label: '散落', description: '詞句隨機散佈傾斜，唱到時彈出發光' },
  { value: 'calm', label: '靜謐', description: '置中排列，逐字掃過的卡拉 OK 填色' },
  { value: 'depth', label: '縱深', description: '文字從遠方飛入，唱過後退回景深' },
  { value: 'bounce', label: '彈跳', description: '每個詞隨拍跳起，以封面主色點亮' },
  { value: 'mist', label: '霧散', description: '從霧中浮現，唱過後緩緩上飄散去' },
  { value: 'marker', label: '螢光筆', description: '靠左排列，唱到的詞以主色螢光筆劃過' },
  { value: 'flip', label: '翻牌', description: '每個詞像翻牌看板一樣由下往上翻起' },
  { value: 'slam', label: '重擊', description: '文字從巨大重重砸下，整句隨之震動' },
  { value: 'neon', label: '霓虹', description: '只有外框的字，唱到時像霓虹燈閃爍點亮' },
  // The four below re-create the ideas of folia-major's Partita, Tilt, Claddagh and Cappella modes.
  { value: 'partita', label: '雲階', description: '歌詞拆成小段排成階梯，唱到的段落畫出引導線' },
  { value: 'tilt', label: '傾斜', description: '分成數行，其中一行是交錯起伏的大字斜體' },
  { value: 'claddagh', label: '指環', description: '文字排在傾斜的立體環上，隨歌聲轉動' },
  { value: 'cappella', label: '聊天室', description: '歌詞變成聊天對話，一句句打字送出' },
];

interface PreferencesState {
  lyricsFont: LyricsFont;
  lyricsMode: LyricsMode;
  immersiveStyle: ImmersiveStyle;
  setLyricsFont: (font: LyricsFont) => void;
  setLyricsMode: (mode: LyricsMode) => void;
  setImmersiveStyle: (style: ImmersiveStyle) => void;
}

export const usePreferences = create<PreferencesState>()(
  persist(
    (set) => ({
      lyricsFont: 'sans',
      lyricsMode: 'scroll',
      immersiveStyle: 'scatter',
      setLyricsFont: (lyricsFont) => set({ lyricsFont }),
      setLyricsMode: (lyricsMode) => set({ lyricsMode }),
      setImmersiveStyle: (immersiveStyle) => set({ immersiveStyle }),
    }),
    { name: 'ascooo-preferences' },
  ),
);

// Mirror onto <html> so the stylesheet can switch the lyrics font everywhere.
const applyLyricsFont = (font: LyricsFont) => { document.documentElement.dataset.lyricsFont = font; };
applyLyricsFont(usePreferences.getState().lyricsFont);
usePreferences.subscribe((state) => applyLyricsFont(state.lyricsFont));
