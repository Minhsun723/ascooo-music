import { create } from 'zustand';
import { api } from '../api/client';
import type { SyncStatus } from '../api/types';
import { toast } from './toast';

interface SyncState {
  status: SyncStatus | null;
  syncing: boolean;
  progress: string;
  loadStatus: () => Promise<void>;
  run: () => Promise<void>;
}

/** Keeps a browser-driven library sync alive and visible across route changes. */
export const useLibrarySync = create<SyncState>((set, get) => ({
  status: null,
  syncing: false,
  progress: '',

  async loadStatus() {
    set({ status: await api.sync.status() });
  },

  async run() {
    if (get().syncing) return;

    set({ syncing: true });
    try {
      const connection = await api.sync.ping();
      const scanId = crypto.randomUUID();
      const folders: (string | undefined)[] = [undefined];
      let scanned = 0;
      let found = 0;
      let oversizedCovers = 0;

      while (folders.length) {
        const folder = folders.shift();
        const result = await api.sync.list(folder, scanId);
        folders.push(...result.dirs);
        scanned += 1;
        found += result.audioFiles;
        if (result.skippedOversizedCover) oversizedCovers += 1;
        set({ progress: `掃描 ${scanned} 個資料夾 · 找到 ${found} 個音訊檔${oversizedCovers ? ` · ${oversizedCovers} 張封面超過 1.9 MB` : ''}` });
      }

      let remaining = 1;
      let processed = 0;
      while (remaining > 0) {
        const result = await api.sync.process(4);
        processed += result.processed.length;
        remaining = result.remaining;
        set({ progress: `正在讀取音樂資訊 · 已完成 ${processed} 首 · 剩下 ${remaining} 首` });
      }

      set({ progress: '整理已移除的檔案…' });
      await api.sync.finalize(scanId, connection.root);
      await get().loadStatus();
      toast(oversizedCovers ? `同步完成；${oversizedCovers} 張封面超過 1.9 MB，請縮小後再同步` : '音樂庫同步完成');
      set({ progress: oversizedCovers ? `同步完成 · ${oversizedCovers} 張封面需要縮小` : '同步完成' });
    } catch (error) {
      const message = (error as Error).message;
      toast(message, 'error');
      set({ progress: `同步中斷：${message}` });
    } finally {
      set({ syncing: false });
    }
  },
}));
