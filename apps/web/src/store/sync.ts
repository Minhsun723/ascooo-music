import { create } from 'zustand';
import { api } from '../api/client';
import type { SyncStatus } from '../api/types';

interface SyncState {
  status: SyncStatus | null;
  loadStatus: () => Promise<void>;
}

/** Library counts shown on the settings page. */
export const useLibrarySync = create<SyncState>((set) => ({
  status: null,

  async loadStatus() {
    set({ status: await api.sync.status() });
  },
}));
