import { create } from 'zustand';
import type { LoginPrompt } from '../lib/login-gate';

interface LoginPromptState {
  prompt: LoginPrompt | null;
  show: (prompt: LoginPrompt) => void;
  close: () => void;
}

export const useLoginPrompt = create<LoginPromptState>((set) => ({
  prompt: null,
  show: (prompt) => set({ prompt }),
  close: () => set({ prompt: null }),
}));
