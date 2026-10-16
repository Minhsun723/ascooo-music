import { createHash, randomUUID } from 'node:crypto';
import { chmod, mkdir, readFile, rename, unlink, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import sharp from 'sharp';
import { ARTWORK_SIZES, type ArtworkSize } from '../apps/worker/src/lib/artwork';
import { AUDIO_EXTENSIONS, type AudioMetadata, extOf, extractMetadata, guessFromFilename } from '../apps/worker/src/lib/metadata';
import { type DavEntry, WebDAV, normalizePath } from '../apps/worker/src/lib/webdav';
import { AppleMusicClient, appleArtworkUrl, type AppleArtwork, type AppleMusicMatch } from './apple-music';

const COVER_NAMES = ['cover', 'folder', 'front', 'album', 'albumart', 'albumcover', 'artwork', 'jacket', '封面', '專輯封面', '专辑封面'];
const IMAGE_EXT = ['jpg', 'jpeg', 'png', 'webp', 'avif', 'gif'];
const projectRoot = process.cwd();
const cacheFile = resolve(projectRoot, '.sync-cache/library.json');
const uploadStateFile = resolve(projectRoot, '.sync-cache/upload-state.json');
// PikPak occasionally returns a short-lived 404 while creating a fresh signed
// download URL. A repeated 404 is still treated as a real missing file.
const transientHttpError = /HTTP (?:404|408|425|429|500|502|503|504)\b/;
const dailyD1LimitError = /exceeded D1's free tier daily/i;

interface PreparedArtworkVariant {
  size: ArtworkSize;
  width: number;
  height: number;
  checksum: string;
  data: string;
}

interface PreparedArtwork {
  id: string;
  variants: PreparedArtworkVariant[];
}

interface PreparedTrack {
  scanId: string;
  path: string;
  size: number;
  etag: string | null;
  mtime: number | null;
  lrcPath: string | null;
  lrcSignature: string | null;
  coverPath: string | null;
  coverSignature: string | null;
  metadata: Omit<AudioMetadata, 'picture' | 'lyrics'>;
  metadataError: string | null;
  lyrics: {
    content: string;
    source: 'lrc' | 'ttml' | 'embedded' | 'apple-music';
    format: 'lrc' | 'ttml' | 'plain';
  } | null;
  appleMusic: (Omit<AppleMusicMatch, 'artistArtwork' | 'songArtwork'> & {
    artistArtworkId: string | null;
    lyricsSongId: string | null;
    lyricsAudioLocale: string | null;
    lyricsHasTimeSyncedLyrics: boolean | null;
  }) | null;
  appleCheckedAt: number | null;
  appleLyricsCheckedAt: number | null;
  trackArtworkId: string | null;
  folderArtworkId: string | null;
}

interface SyncManifest {
  version: 5;
  createdAt: string;
  root: string;
  scanId: string;
  artworks: PreparedArtwork[];
  tracks: PreparedTrack[];
}

interface UploadState {
  scanId: string;
  artworkIndex: number;
  trackIndex: number;
}

function concurrencyFromEnvironment(): number {
  const value = Number(process.env.SYNC_PARSE_CONCURRENCY ?? 1);
  return Number.isFinite(value) ? Math.min(Math.max(Math.floor(value), 1), 8) : 1;
}

function entrySignature(file: DavEntry | null | undefined): string | null {
  if (!file) return null;
  return file.etag || `${file.size}:${file.mtime ?? ''}`;
}

function hasStableSignature(file: DavEntry | null | undefined): boolean {
  return !file || !!file.etag || file.mtime !== null;
}

function trackSignature(track: PreparedTrack): string {
  return track.etag || `${track.size}:${track.mtime ?? ''}`;
}

async function mapConcurrent<T, R>(items: T[], concurrency: number, operation: (item: T) => Promise<R>): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (true) {
      const index = next++;
      if (index >= items.length) return;
      results[index] = await operation(items[index]);
    }
  });
  await Promise.all(workers);
  return results;
}

async function previousManifest(root: string): Promise<SyncManifest | null> {
  try {
    const manifest = JSON.parse(await readFile(cacheFile, 'utf8')) as SyncManifest & { version: number };
    if (manifest.root !== root || ![4, 5].includes(manifest.version)) return null;
    if (manifest.version === 5) return manifest;
    return {
      ...manifest,
      version: 5,
      tracks: manifest.tracks.map((track) => ({
        ...track,
        appleMusic: track.appleMusic ? {
          ...track.appleMusic,
          lyricsSongId: track.appleMusic.lyricsSongId ?? null,
          lyricsAudioLocale: track.appleMusic.lyricsAudioLocale ?? null,
          lyricsHasTimeSyncedLyrics: track.appleMusic.lyricsHasTimeSyncedLyrics ?? null,
        } : null,
      })),
    };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT' || error instanceof SyntaxError) return null;
    throw error;
  }
}

// On Windows, Defender, the search indexer or editor file watchers can hold the
// destination open for a moment, making an atomic replace fail with EPERM.
async function replaceFile(source: string, destination: string): Promise<void> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await rename(source, destination);
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (!['EPERM', 'EACCES', 'EBUSY'].includes(code ?? '') || attempt === 9) throw error;
      await new Promise((resolveDelay) => setTimeout(resolveDelay, 50 * 2 ** Math.min(attempt, 5)));
    }
  }
}

async function persistManifest(manifest: SyncManifest): Promise<void> {
  await mkdir(dirname(cacheFile), { recursive: true });
  const temporaryCache = `${cacheFile}.tmp`;
  await writeFile(temporaryCache, JSON.stringify(manifest), { mode: 0o600 });
  await replaceFile(temporaryCache, cacheFile);
  await chmod(cacheFile, 0o600);
}

async function loadUploadState(scanId: string): Promise<UploadState> {
  try {
    const state = JSON.parse(await readFile(uploadStateFile, 'utf8')) as UploadState;
    if (state.scanId === scanId) return state;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT' && !(error instanceof SyntaxError)) throw error;
  }
  return { scanId, artworkIndex: 0, trackIndex: 0 };
}

async function persistUploadState(state: UploadState): Promise<void> {
  await mkdir(dirname(uploadStateFile), { recursive: true });
  const temporaryState = `${uploadStateFile}.tmp`;
  await writeFile(temporaryState, JSON.stringify(state), { mode: 0o600 });
  await replaceFile(temporaryState, uploadStateFile);
}

async function clearUploadState(): Promise<void> {
  await unlink(uploadStateFile).catch((error: NodeJS.ErrnoException) => {
    if (error.code !== 'ENOENT') throw error;
  });
}

function parseEnvFile(content: string) {
  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const separator = line.indexOf('=');
    if (separator < 1) continue;
    const key = line.slice(0, separator).trim();
    let value = line.slice(separator + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    process.env[key] ??= value;
  }
}

async function loadLocalEnvironment() {
  try {
    parseEnvFile(await readFile(resolve(projectRoot, '.dev.vars'), 'utf8'));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
  }
}

function required(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`缺少 ${name}，請在 .dev.vars 設定`);
  return value;
}

const stem = (path: string) => path.slice(path.lastIndexOf('/') + 1).replace(/\.[^.]+$/, '').toLowerCase();

function normalizedCoverName(name: string): string {
  return stem(name).normalize('NFKC').replace(/[\s._()[\]{}-]+/g, '');
}

function coverRank(name: string): number | null {
  const value = normalizedCoverName(name);
  const exact = COVER_NAMES.indexOf(value);
  if (exact >= 0) return exact;
  const partial = COVER_NAMES.findIndex((candidate) => value.startsWith(candidate) || value.endsWith(candidate));
  return partial >= 0 ? 50 + partial : null;
}

function folderCover(files: DavEntry[]): DavEntry | null {
  const images = files.filter((file) => IMAGE_EXT.includes(extOf(file.name)));
  const named = images
    .map((file) => ({ file, rank: coverRank(file.name) }))
    .filter((candidate): candidate is { file: DavEntry; rank: number } => candidate.rank !== null)
    .sort((a, b) => a.rank - b.rank || a.file.size - b.file.size);
  const candidates = named.length ? named.map((candidate) => candidate.file) : images.length === 1 ? images : [];
  return candidates[0] ?? null;
}

const sha1 = (data: Uint8Array) => createHash('sha1').update(data).digest('hex');
const sha256 = (data: Uint8Array) => createHash('sha256').update(data).digest('hex');
const LRC_SYNCED = /^\s*\[\d{1,3}:\d{2}(?:[.:]\d{1,3})?\]/m;
const INSTRUMENTAL_TITLE = /\b(?:instrumental|karaoke|off[\s-]?vocal)\b|伴奏|インスト(?:ゥルメンタル)?/iu;

function lyricsFormat(path: string, content: string): 'lrc' | 'ttml' | 'plain' {
  if (extOf(path) === 'ttml' || /<tt(?:\s|>)/i.test(content)) return 'ttml';
  return LRC_SYNCED.test(content) || extOf(path) === 'lrc' ? 'lrc' : 'plain';
}

function refreshInterval(): number {
  const days = Number(process.env.APPLE_MUSIC_REFRESH_DAYS ?? 90);
  const normalized = Number.isFinite(days) ? Math.min(Math.max(days, 1), 365) : 90;
  return normalized * 24 * 60 * 60 * 1000;
}

const warningKeys = new Set<string>();
function warnOnce(key: string, message: string): void {
  if (warningKeys.has(key)) return;
  warningKeys.add(key);
  console.warn(message);
}

async function addArtwork(
  artworks: Map<string, PreparedArtwork>,
  artworkJobs: Map<string, Promise<string>>,
  data: Uint8Array,
): Promise<string> {
  const id = sha1(data);
  if (artworks.has(id)) return id;
  const inFlight = artworkJobs.get(id);
  if (inFlight) return inFlight;

  const job = (async () => {
    const input = Buffer.from(data.buffer, data.byteOffset, data.byteLength);
    const variants = await Promise.all(ARTWORK_SIZES.map(async (size): Promise<PreparedArtworkVariant> => {
      const quality = size === 512 ? 80 : 84;
      const result = await sharp(input, { failOn: 'none' })
        .autoOrient()
        .resize(size, size, { fit: 'inside', withoutEnlargement: true })
        .webp({ quality, effort: 4, smartSubsample: true })
        .toBuffer({ resolveWithObject: true });
      return {
        size,
        width: result.info.width,
        height: result.info.height,
        checksum: sha256(result.data),
        data: result.data.toString('base64'),
      };
    }));
    artworks.set(id, { id, variants });
    return id;
  })();
  artworkJobs.set(id, job);
  try {
    return await job;
  } finally {
    artworkJobs.delete(id);
  }
}

async function addAppleArtwork(
  artworks: Map<string, PreparedArtwork>,
  jobs: Map<string, Promise<string | null>>,
  artwork: AppleArtwork,
): Promise<string | null> {
  const existing = jobs.get(artwork.url);
  if (existing) return existing;

  const job = (async () => {
    const variants = await Promise.all(ARTWORK_SIZES.map(async (size): Promise<PreparedArtworkVariant> => {
      const response = await fetch(appleArtworkUrl(artwork.url, size));
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      let data = Buffer.from(await response.arrayBuffer());
      let metadata = await sharp(data, { failOn: 'none' }).metadata();
      if (metadata.format !== 'webp') {
        data = await sharp(data, { failOn: 'none' }).webp({ quality: size === 512 ? 82 : 86, effort: 4 }).toBuffer();
        metadata = await sharp(data).metadata();
      }
      const width = metadata.width ?? 0;
      const height = metadata.height ?? 0;
      if (!width || !height || width > size || height > size) throw new Error(`${size}px 藝人照片尺寸無效`);
      return {
        size,
        width,
        height,
        checksum: sha256(data),
        data: data.toString('base64'),
      };
    }));
    const id = sha1(Buffer.from(variants[0].data, 'base64'));
    if (!artworks.has(id)) artworks.set(id, { id, variants });
    return id;
  })().catch((error) => {
    warnOnce(`artist-art:${artwork.url}`, `  略過 Apple Music 藝人照片：${error instanceof Error ? error.message : String(error)}`);
    return null;
  });
  jobs.set(artwork.url, job);
  return job;
}

async function withReadRetry<T>(label: string, operation: () => Promise<T>): Promise<T> {
  let lastError: unknown;
  for (let attempt = 0; attempt < 5; attempt++) {
    try {
      return await operation();
    } catch (error) {
      lastError = error;
      const message = error instanceof Error ? error.message : String(error);
      if (!transientHttpError.test(message) || attempt === 4) throw error;
      const delay = /HTTP 404\b/.test(message)
        ? Math.min(4_000 * 2 ** attempt, 30_000) + Math.floor(Math.random() * 500)
        : 750 * 2 ** attempt + Math.floor(Math.random() * 250);
      console.warn(`  ${label} 暫時失敗，${delay}ms 後重試：${message}`);
      await new Promise((resolveDelay) => setTimeout(resolveDelay, delay));
    }
  }
  throw lastError;
}

async function prepare(): Promise<SyncManifest> {
  const env = {
    WEBDAV_URL: required('WEBDAV_URL'),
    MUSIC_ROOT: process.env.MUSIC_ROOT?.trim() || '/',
    WEBDAV_USERNAME: process.env.WEBDAV_USERNAME,
    WEBDAV_PASSWORD: process.env.WEBDAV_PASSWORD,
    WEBDAV_BEARER_TOKEN: process.env.WEBDAV_BEARER_TOKEN,
    WEBDAV_AUTH_MODE: process.env.WEBDAV_AUTH_MODE as 'auto' | 'basic' | 'bearer' | undefined,
  };
  const dav = new WebDAV(env as never);
  const root = normalizePath(env.MUSIC_ROOT);
  const appleLyricsRoot = normalizePath(process.env.APPLE_MUSIC_LYRICS_PATH?.trim() || '/ascooo-music/lyrics');
  const concurrency = concurrencyFromEnvironment();
  const folders: string[] = [root];
  const seenFolders = new Set(folders);
  const contents: { dir: string; files: DavEntry[] }[] = [];

  let apple: AppleMusicClient | null = null;
  if (!/^(?:0|false|off)$/i.test(process.env.APPLE_MUSIC_ENABLED?.trim() || 'true')) {
    const candidate = new AppleMusicClient({
      developerToken: process.env.APPLE_MUSIC_DEVELOPER_TOKEN,
      mediaUserToken: process.env.APPLE_MUSIC_USER_TOKEN,
      storefront: process.env.APPLE_MUSIC_STOREFRONT || 'jp',
      lyricsStorefront: process.env.APPLE_MUSIC_LYRICS_STOREFRONT,
      language: process.env.APPLE_MUSIC_LANGUAGE || 'ja-JP',
    });
    try {
      await candidate.initialize();
      apple = candidate;
      console.log(`Apple Music 已啟用（目錄 ${candidate.storefront}/${candidate.language}；歌詞 ${candidate.lyricsStorefront}${candidate.hasMediaUserToken ? '，含訂閱權限' : '，未設定訂閱 Token'}）`);
    } catch (error) {
      console.warn(`Apple Music 暫時無法使用，將保留既有資料：${error instanceof Error ? error.message : String(error)}`);
    }
  }

  const appleLyricsFiles = new Map<string, DavEntry>();
  try {
    const entries = await withReadRetry(`掃描 ${appleLyricsRoot}`, () => dav.list(appleLyricsRoot));
    for (const entry of entries) if (!entry.isDir && extOf(entry.name) === 'ttml') appleLyricsFiles.set(entry.name.toLowerCase(), entry);
    console.log(`  PikPak 歌詞庫：${appleLyricsFiles.size} 份 TTML`);
  } catch (error) {
    warnOnce('lyrics-root', `  無法讀取 ${appleLyricsRoot}：${error instanceof Error ? error.message : String(error)}`);
  }

  const appleLyricsJobs = new Map<string, Promise<{
    content: string;
    path: string;
    signature: string | null;
  } | null>>();
  const resolveAppleLyrics = (
    songId: string,
    audioLocale: string | null,
    hasTimeSyncedLyrics: boolean,
  ) => {
    const existingJob = appleLyricsJobs.get(songId);
    if (existingJob) return existingJob;
    const job = (async () => {
      const destination = normalizePath(`${appleLyricsRoot}/${songId}.ttml`);
      const existingFile = appleLyricsFiles.get(`${songId}.ttml`.toLowerCase());
      if (existingFile) {
        try {
          const content = (await withReadRetry(
            `讀取歌詞 ${existingFile.path}`,
            () => dav.readText(existingFile.path),
          )).trim();
          if (content) {
            return { content, path: existingFile.path, signature: entrySignature(existingFile) };
          }
        } catch (error) {
          console.warn(`  既有 TTML 暫時無法讀取，將嘗試重新取得 ${songId}：${error instanceof Error ? error.message : String(error)}`);
        }
      }
      if (!apple || !hasTimeSyncedLyrics) return null;
      const content = await apple.fetchLyrics(songId, audioLocale);
      if (!content) return null;
      await withReadRetry(
        `上傳歌詞 ${destination}`,
        () => dav.writeText(destination, content, 'application/ttml+xml; charset=utf-8'),
      );
      console.log(`  已保存 TTML：${destination}`);
      return { content, path: destination, signature: sha256(Buffer.from(content)) };
    })();
    appleLyricsJobs.set(songId, job);
    return job;
  };

  console.log(`本機掃描 ${root}（並行 ${concurrency}）`);
  while (folders.length) {
    const batch = folders.splice(0, concurrency);
    const listed = await Promise.all(batch.map(async (dir) => ({
      dir,
      entries: await withReadRetry(`掃描 ${dir}`, () => dav.list(dir)),
    })));
    for (const { dir, entries } of listed) {
      for (const entry of entries) {
        if (entry.isDir && !seenFolders.has(entry.path)) {
          seenFolders.add(entry.path);
          folders.push(entry.path);
        }
      }
      contents.push({ dir, files: entries.filter((entry) => !entry.isDir) });
    }
    console.log(`  已掃描 ${contents.length} 個資料夾`);
  }

  const scanId = randomUUID();
  const previous = await previousManifest(root);
  const previousByPath = new Map(previous?.tracks.map((track) => [track.path, track]) ?? []);
  const artworks = new Map(previous?.artworks.map((artwork) => [artwork.id, artwork]) ?? []);
  const artworkJobs = new Map<string, Promise<string>>();
  const appleArtworkJobs = new Map<string, Promise<string | null>>();
  const tracks: PreparedTrack[] = [];
  const audioCount = contents.reduce(
    (count, folder) => count + folder.files.filter((file) => AUDIO_EXTENSIONS.includes(extOf(file.name))).length,
    0,
  );
  let completed = 0;
  let reused = 0;
  if (previous) console.log(`  已載入上次快取，未變動歌曲會直接沿用`);

  const jobs = contents.flatMap((folder) => {
    const audioFiles = folder.files.filter((file) => AUDIO_EXTENSIONS.includes(extOf(file.name)));
    if (!audioFiles.length) return [];
    const lyricsByStem = new Map(folder.files.filter((file) => extOf(file.name) === 'lrc').map((file) => [stem(file.name), file]));
    for (const file of folder.files.filter((entry) => extOf(entry.name) === 'ttml')) lyricsByStem.set(stem(file.name), file);
    const cover = folderCover(folder.files);
    const coverSignature = entrySignature(cover);
    const cachedFolderArtworkId = audioFiles
      .map((file) => previousByPath.get(file.path))
      .find((track) => track?.coverPath === (cover?.path ?? null) && track.coverSignature === coverSignature)
      ?.folderArtworkId ?? null;
    let folderArtworkPromise: Promise<string | null> | null = null;
    const getFolderArtwork = () => {
      if (cachedFolderArtworkId && artworks.has(cachedFolderArtworkId)) return Promise.resolve(cachedFolderArtworkId);
      if (!cover) return Promise.resolve(null);
      folderArtworkPromise ??= (async () => {
        try {
          const data = await withReadRetry(`讀取封面 ${cover.path}`, async () => {
            const response = await dav.fetchFile(cover.path);
            if (!response.ok) throw new Error(`讀取 ${cover.path} 失敗：HTTP ${response.status}`);
            return new Uint8Array(await response.arrayBuffer());
          });
          if (!data.length) return null;
          return await addArtwork(artworks, artworkJobs, data);
        } catch (error) {
          console.warn(`  略過封面 ${cover.path}：${error instanceof Error ? error.message : String(error)}`);
          return null;
        }
      })();
      return folderArtworkPromise;
    };
    return audioFiles.map((file) => ({ file, lyricsByStem, cover, coverSignature, getFolderArtwork }));
  });

  const preparedTracks = await mapConcurrent(jobs, concurrency, async ({
    file,
    lyricsByStem,
    cover,
    coverSignature,
    getFolderArtwork,
  }): Promise<PreparedTrack> => {
      const cached = previousByPath.get(file.path);
      const adjacentLyrics = lyricsByStem.get(stem(file.name)) ?? null;
      const cachedLyricsIds = [cached?.appleMusic?.lyricsSongId, cached?.appleMusic?.songId]
        .filter((id): id is string => !!id);
      const cachedAppleLyrics = cachedLyricsIds
        .map((id) => appleLyricsFiles.get(`${id}.ttml`.toLowerCase()))
        .find((file): file is DavEntry => !!file) ?? null;
      const currentLyricsFile = adjacentLyrics ?? cachedAppleLyrics;
      const currentLyricsPath = currentLyricsFile?.path ?? null;
      const currentLyricsSignature = entrySignature(currentLyricsFile);
      const audioUnchanged = !!cached && !cached.metadataError &&
        hasStableSignature(file) && hasStableSignature(cover) &&
        trackSignature(cached) === entrySignature(file) &&
        cached.coverPath === (cover?.path ?? null) && cached.coverSignature === coverSignature;
      const cachedGuess = cached ? guessFromFilename(cached.path) : null;
      const cachedNeedsArtistRecovery = !!cached && !cached.appleMusic &&
        !(cached.metadata.artist || cached.metadata.albumArtist || cachedGuess?.artist);
      const appleFresh = !apple || !cachedNeedsArtistRecovery &&
        !!cached?.appleCheckedAt && Date.now() - cached.appleCheckedAt < refreshInterval();
      const cachedLyricsReusable = !!cached?.lyrics && cached.lrcPath === currentLyricsPath;
      const lyricsReady = !apple?.hasMediaUserToken || !!cached?.lyrics || !!currentLyricsFile ||
        !cached?.appleMusic?.hasTimeSyncedLyrics || !!cached.appleLyricsCheckedAt;
      const unchanged = audioUnchanged && appleFresh && lyricsReady &&
        (cachedLyricsReusable || (
          hasStableSignature(currentLyricsFile) && cached!.lrcPath === currentLyricsPath &&
          cached!.lrcSignature === currentLyricsSignature
        ));
      if (unchanged) {
        completed++;
        reused++;
        console.log(`  沿用快取 ${completed}/${audioCount}：${file.name}`);
        return { ...cached, scanId };
      }

      const folderArtworkId = audioUnchanged ? cached!.folderArtworkId : await getFolderArtwork();
      let metadata: AudioMetadata = {};
      let metadataError: string | null = null;
      let embeddedLyrics: string | undefined;
      if (audioUnchanged) {
        metadata = { ...cached!.metadata };
        metadataError = cached!.metadataError;
        if (cached!.lyrics?.source === 'embedded') embeddedLyrics = cached!.lyrics.content;
      } else {
        try {
          metadata = await withReadRetry(`解析 ${file.path}`, () => extractMetadata(dav, file.path, file.size));
        } catch (error) {
          metadataError = error instanceof Error ? error.message : String(error);
          // Never replace known-good metadata with empty fields after an
          // upstream read failure. metadataError forces another attempt next run.
          if (cached) {
            metadata = { ...cached.metadata };
            if (cached.lyrics?.source === 'embedded') embeddedLyrics = cached.lyrics.content;
          }
        }
      }

      const { picture, lyrics: parsedEmbeddedLyrics, ...preparedMetadata } = metadata;
      embeddedLyrics ??= parsedEmbeddedLyrics;
      let trackArtworkId: string | null = audioUnchanged || metadataError
        ? cached?.trackArtworkId ?? null
        : null;
      if (!audioUnchanged && picture?.data.length) {
        try {
          trackArtworkId = await addArtwork(artworks, artworkJobs, picture.data);
        } catch (error) {
          console.warn(`  略過內嵌封面 ${file.path}：${error instanceof Error ? error.message : String(error)}`);
        }
      }

      let appleMusic = cached?.appleMusic ?? null;
      let appleCheckedAt = cached?.appleCheckedAt ?? null;
      let appleLyricsCheckedAt = cached?.appleLyricsCheckedAt ?? null;
      if (apple && (!appleFresh || !audioUnchanged)) {
        const guess = guessFromFilename(file.path);
        const sourceTitle = preparedMetadata.title || guess.title;
        const sourceArtist = preparedMetadata.artist || guess.artist || preparedMetadata.albumArtist || '';
        try {
          const matchInput = {
            title: sourceTitle,
            artist: sourceArtist,
            album: preparedMetadata.album,
            duration: preparedMetadata.duration,
            isrc: preparedMetadata.isrc,
          };
          let match = await apple.matchTrack(matchInput);
          if (!match && !sourceArtist && apple.storefront !== apple.lyricsStorefront) {
            match = await apple.matchLyricsTrack(matchInput);
          }
          let artistArtworkId: string | null = null;
          if (match?.artistArtwork) artistArtworkId = await addAppleArtwork(artworks, appleArtworkJobs, match.artistArtwork);
          if (!trackArtworkId && match?.songArtwork) {
            trackArtworkId = await addAppleArtwork(artworks, appleArtworkJobs, match.songArtwork);
          }
          if (match) {
            appleMusic = {
              songId: match.songId,
              isrc: match.isrc,
              title: match.title,
              artistName: match.artistName,
              artistId: match.artistId,
              audioLocale: match.audioLocale,
              displayTitle: match.displayTitle,
              displayArtist: match.displayArtist,
              confidence: match.confidence,
              hasLyrics: match.hasLyrics,
              hasTimeSyncedLyrics: match.hasTimeSyncedLyrics,
              artistArtworkId,
              lyricsSongId: null,
              lyricsAudioLocale: null,
              lyricsHasTimeSyncedLyrics: null,
            };
          } else {
            appleMusic = null;
          }
          appleCheckedAt = Date.now();
          if (cached?.appleMusic?.songId !== appleMusic?.songId) appleLyricsCheckedAt = null;
        } catch (error) {
          warnOnce('apple-match', `  Apple Music 配對暫停，本次保留既有結果：${error instanceof Error ? error.message : String(error)}`);
        }
      }

      let lyricsFile = adjacentLyrics;
      if (!lyricsFile && appleMusic) {
        const lyricsIds = [appleMusic.lyricsSongId, appleMusic.songId].filter((id): id is string => !!id);
        lyricsFile = lyricsIds
          .map((id) => appleLyricsFiles.get(`${id}.ttml`.toLowerCase()))
          .find((file): file is DavEntry => !!file) ?? null;
      }
      let lrcPath = lyricsFile?.path ?? null;
      let lrcSignature = entrySignature(lyricsFile);
      let lyrics: PreparedTrack['lyrics'] = null;
      const sourceTitle = preparedMetadata.title || guessFromFilename(file.path).title;
      const isInstrumental = INSTRUMENTAL_TITLE.test(sourceTitle);
      if (lyricsFile) {
        try {
          const content = (await withReadRetry(`讀取歌詞 ${lyricsFile.path}`, () => dav.readText(lyricsFile.path))).trim();
          const format = lyricsFormat(lyricsFile.path, content);
          if (content) lyrics = {
            content,
            format,
            source: format === 'ttml' ? (lyricsFile.path.startsWith(`${appleLyricsRoot}/`) ? 'apple-music' : 'ttml') : 'lrc',
          };
        } catch (error) {
          console.warn(`  略過歌詞 ${lyricsFile.path}：${error instanceof Error ? error.message : String(error)}`);
        }
      }
      if (!lyrics && cached?.lyrics) {
        lyrics = cached.lyrics;
        lrcPath = cached.lrcPath;
        lrcSignature = cached.lrcSignature;
      }
      if (!lyrics && !isInstrumental && apple?.hasMediaUserToken && appleMusic?.songId && appleMusic.hasLyrics) {
        try {
          let lyricsSongId = appleMusic.lyricsSongId ?? appleMusic.songId;
          let lyricsAudioLocale = appleMusic.lyricsAudioLocale ?? appleMusic.audioLocale;
          let lyricsHasTimeSyncedLyrics = appleMusic.lyricsHasTimeSyncedLyrics ?? appleMusic.hasTimeSyncedLyrics;

          // Catalog IDs are not guaranteed to be identical between Japan and
          // the subscriber storefront. Resolve the account-region ID before
          // fetching so an existing TTML can be reused without another Apple
          // request or another PikPak file.
          if (apple.storefront !== apple.lyricsStorefront && !appleMusic.lyricsSongId) {
            const guess = guessFromFilename(file.path);
            const lyricsMatch = await apple.matchLyricsTrack({
              title: preparedMetadata.title || guess.title,
              artist: preparedMetadata.artist || guess.artist || preparedMetadata.albumArtist || appleMusic.artistName,
              album: preparedMetadata.album,
              duration: preparedMetadata.duration,
              isrc: preparedMetadata.isrc || appleMusic.isrc || undefined,
            });
            if (lyricsMatch) {
              lyricsSongId = lyricsMatch.songId;
              lyricsAudioLocale = lyricsMatch.audioLocale;
              lyricsHasTimeSyncedLyrics = lyricsMatch.hasTimeSyncedLyrics;
              appleMusic.lyricsSongId = lyricsSongId;
              appleMusic.lyricsAudioLocale = lyricsAudioLocale;
              appleMusic.lyricsHasTimeSyncedLyrics = lyricsHasTimeSyncedLyrics;
            }
          }

          const resolved = await resolveAppleLyrics(
            lyricsSongId,
            lyricsAudioLocale,
            lyricsHasTimeSyncedLyrics,
          );
          appleLyricsCheckedAt = Date.now();
          if (resolved) {
            appleMusic.lyricsSongId = lyricsSongId;
            appleMusic.lyricsAudioLocale = lyricsAudioLocale;
            appleMusic.lyricsHasTimeSyncedLyrics = lyricsHasTimeSyncedLyrics;
            lyrics = { content: resolved.content, source: 'apple-music', format: 'ttml' };
            lrcPath = resolved.path;
            lrcSignature = resolved.signature;
          }
        } catch (error) {
          console.warn(`  Apple Music 歌詞略過 ${file.name}：${error instanceof Error ? error.message : String(error)}`);
        }
      } else if (apple?.hasMediaUserToken && appleMusic && (isInstrumental || !appleMusic.hasTimeSyncedLyrics)) {
        appleLyricsCheckedAt = Date.now();
      }
      if (!lyrics && embeddedLyrics) {
        lyrics = { content: embeddedLyrics, source: 'embedded', format: lyricsFormat('', embeddedLyrics) };
      }
      const track: PreparedTrack = {
        scanId,
        path: file.path,
        size: file.size,
        etag: file.etag,
        mtime: file.mtime,
        lrcPath,
        lrcSignature,
        coverPath: cover?.path ?? null,
        coverSignature,
        metadata: preparedMetadata,
        metadataError,
        lyrics,
        appleMusic,
        appleCheckedAt,
        appleLyricsCheckedAt,
        trackArtworkId,
        folderArtworkId,
      };
      completed++;
      console.log(`  本機解析 ${completed}/${audioCount}：${file.name}${metadataError ? `（${metadataError}）` : ''}`);
      return track;
  });
  tracks.push(...preparedTracks);

  const referencedArtwork = new Set(tracks.flatMap((track) => [
    track.trackArtworkId,
    track.folderArtworkId,
    track.appleMusic?.artistArtworkId,
  ]).filter((id): id is string => !!id));
  console.log(`本機解析完成：${audioCount} 首；沿用 ${reused} 首，重新解析 ${audioCount - reused} 首`);

  return {
    version: 5,
    createdAt: new Date().toISOString(),
    root,
    scanId,
    artworks: [...artworks.values()].filter((artwork) => referencedArtwork.has(artwork.id)),
    tracks,
  };
}

async function responseError(response: Response): Promise<string> {
  try {
    const body = await response.json() as { error?: string };
    return body.error || `HTTP ${response.status}`;
  } catch {
    return `HTTP ${response.status}`;
  }
}

async function login(baseUrl: string): Promise<string> {
  let lastError = '';
  for (let attempt = 0; attempt < 5; attempt++) {
    try {
      const response = await fetch(`${baseUrl}/api/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: required('SYNC_ADMIN_USERNAME'), password: required('SYNC_ADMIN_PASSWORD') }),
      });
      if (response.ok) {
        const setCookie = response.headers.get('set-cookie');
        const cookie = setCookie?.split(';', 1)[0];
        if (!cookie) throw new Error('遠端登入成功，但沒有收到 session cookie');
        return cookie;
      }
      lastError = await responseError(response);
      if (dailyD1LimitError.test(lastError)) break;
      if (![429, 500, 502, 503, 504].includes(response.status)) break;
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
    }
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 750 * 2 ** attempt));
  }
  throw new Error(`遠端登入失敗：${lastError}`);
}

async function post(baseUrl: string, cookie: string, path: string, body: unknown, maxAttempts = 5): Promise<unknown> {
  let lastError = '';
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    try {
      const response = await fetch(`${baseUrl}/api${path}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Cookie: cookie },
        body: JSON.stringify(body),
      });
      if (response.ok) return response.json();
      lastError = await responseError(response);
      if (dailyD1LimitError.test(lastError)) break;
      if (![429, 500, 502, 503, 504].includes(response.status) || attempt === maxAttempts - 1) break;
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
    }
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 750 * 2 ** attempt));
  }
  throw new Error(`${path} 上傳失敗：${lastError}`);
}

async function upload(manifest: SyncManifest) {
  if (!manifest.tracks.length) {
    throw new Error('本機掃描沒有找到任何音訊；為避免誤刪線上音樂庫，已停止上傳');
  }
  const failedTracks = manifest.tracks.filter((track) => !!track.metadataError);
  if (failedTracks.length) {
    const examples = failedTracks
      .slice(0, 3)
      .map((track) => track.path.slice(track.path.lastIndexOf('/') + 1))
      .join('、');
    throw new Error(
      `仍有 ${failedTracks.length} 首音訊解析失敗（例如：${examples}），為避免覆蓋既有歌手與封面，已停止上傳；請重新執行 --prepare-only`,
    );
  }
  const baseUrl = (process.env.SYNC_TARGET_URL?.trim() || 'https://music.ascooo.com').replace(/\/$/, '');
  const target = new URL(baseUrl);
  if (target.protocol !== 'https:' && !['localhost', '127.0.0.1'].includes(target.hostname)) {
    throw new Error('SYNC_TARGET_URL 必須使用 HTTPS（本機 localhost 除外）');
  }
  console.log(`登入 ${baseUrl}`);
  const cookie = await login(baseUrl);
  const state = await loadUploadState(manifest.scanId);
  if (state.artworkIndex || state.trackIndex) {
    console.log(`續傳進度：封面 ${state.artworkIndex}/${manifest.artworks.length}、歌曲 ${state.trackIndex}/${manifest.tracks.length}`);
  }

  for (let index = state.artworkIndex; index < manifest.artworks.length; index++) {
    const artwork = manifest.artworks[index];
    await post(baseUrl, cookie, '/sync/import/artwork', artwork);
    state.artworkIndex = index + 1;
    await persistUploadState(state);
    console.log(`  上傳封面 ${index + 1}/${manifest.artworks.length}`);
  }
  for (let index = state.trackIndex; index < manifest.tracks.length; index++) {
    const track = manifest.tracks[index];
    await post(baseUrl, cookie, '/sync/import/track', track);
    state.trackIndex = index + 1;
    await persistUploadState(state);
    console.log(`  上傳歌曲 ${index + 1}/${manifest.tracks.length}：${track.path.slice(track.path.lastIndexOf('/') + 1)}`);
  }

  await post(baseUrl, cookie, '/sync/finalize', {
    scanId: manifest.scanId,
    dir: manifest.root,
    artworkIds: manifest.artworks.map((artwork) => artwork.id),
  });
  await clearUploadState();
  console.log(`同步完成：${manifest.tracks.length} 首歌曲、${manifest.artworks.length} 張封面`);
}

async function main() {
  await loadLocalEnvironment();
  const prepareOnly = process.argv.includes('--prepare-only');
  const uploadOnly = process.argv.includes('--upload-only');
  if (prepareOnly && uploadOnly) throw new Error('--prepare-only 與 --upload-only 不能同時使用');

  let manifest: SyncManifest;
  if (uploadOnly) {
    const cached = JSON.parse(await readFile(cacheFile, 'utf8')) as SyncManifest & { version: number };
    if (cached.version !== 5) throw new Error('本機同步快取版本不支援，請重新執行準備');
    manifest = cached;
    console.log(`載入本機快取：${manifest.tracks.length} 首歌曲`);
  } else {
    manifest = await prepare();
    await persistManifest(manifest);
    console.log(`本機同步完成，快取已寫入 ${cacheFile}`);
  }

  if (!prepareOnly) await upload(manifest);
}

await main().catch((error) => {
  console.error(`\n同步失敗：${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});
