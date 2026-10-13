import { createHash, randomUUID } from 'node:crypto';
import { chmod, mkdir, readFile, rename, unlink, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import sharp from 'sharp';
import { ARTWORK_SIZES, type ArtworkSize } from '../apps/worker/src/lib/artwork';
import { AUDIO_EXTENSIONS, type AudioMetadata, extOf, extractMetadata } from '../apps/worker/src/lib/metadata';
import { type DavEntry, WebDAV, normalizePath } from '../apps/worker/src/lib/webdav';

const COVER_NAMES = ['cover', 'folder', 'front', 'album', 'albumart', 'albumcover', 'artwork', 'jacket', '封面', '專輯封面', '专辑封面'];
const IMAGE_EXT = ['jpg', 'jpeg', 'png', 'webp', 'avif', 'gif'];
const projectRoot = process.cwd();
const cacheFile = resolve(projectRoot, '.sync-cache/library.json');
const uploadStateFile = resolve(projectRoot, '.sync-cache/upload-state.json');
const transientHttpError = /HTTP (?:429|500|502|503|504)\b/;
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
  lyrics: { content: string; source: 'lrc' | 'embedded' } | null;
  trackArtworkId: string | null;
  folderArtworkId: string | null;
}

interface SyncManifest {
  version: 3;
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
  const value = Number(process.env.SYNC_PARSE_CONCURRENCY ?? 4);
  return Number.isFinite(value) ? Math.min(Math.max(Math.floor(value), 1), 8) : 4;
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
    const manifest = JSON.parse(await readFile(cacheFile, 'utf8')) as SyncManifest;
    return manifest.version === 3 && manifest.root === root ? manifest : null;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT' || error instanceof SyntaxError) return null;
    throw error;
  }
}

async function persistManifest(manifest: SyncManifest): Promise<void> {
  await mkdir(dirname(cacheFile), { recursive: true });
  const temporaryCache = `${cacheFile}.tmp`;
  await writeFile(temporaryCache, JSON.stringify(manifest), { mode: 0o600 });
  await rename(temporaryCache, cacheFile);
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
  await rename(temporaryState, uploadStateFile);
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

async function withReadRetry<T>(label: string, operation: () => Promise<T>): Promise<T> {
  let lastError: unknown;
  for (let attempt = 0; attempt < 4; attempt++) {
    try {
      return await operation();
    } catch (error) {
      lastError = error;
      const message = error instanceof Error ? error.message : String(error);
      if (!transientHttpError.test(message) || attempt === 3) throw error;
      const delay = 750 * 2 ** attempt;
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
  const concurrency = concurrencyFromEnvironment();
  const folders: string[] = [root];
  const seenFolders = new Set(folders);
  const contents: { dir: string; files: DavEntry[] }[] = [];

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
    const lrcByStem = new Map(folder.files.filter((file) => extOf(file.name) === 'lrc').map((file) => [stem(file.name), file]));
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
    return audioFiles.map((file) => ({ file, lrcByStem, cover, coverSignature, getFolderArtwork }));
  });

  const preparedTracks = await mapConcurrent(jobs, concurrency, async ({
    file,
    lrcByStem,
    cover,
    coverSignature,
    getFolderArtwork,
  }): Promise<PreparedTrack> => {
      const lrcFile = lrcByStem.get(stem(file.name)) ?? null;
      const lrcPath = lrcFile?.path ?? null;
      const lrcSignature = entrySignature(lrcFile);
      const cached = previousByPath.get(file.path);
      const unchanged = cached && !cached.metadataError &&
        hasStableSignature(file) && hasStableSignature(lrcFile) && hasStableSignature(cover) &&
        trackSignature(cached) === entrySignature(file) &&
        cached.lrcPath === lrcPath && cached.lrcSignature === lrcSignature &&
        cached.coverPath === (cover?.path ?? null) && cached.coverSignature === coverSignature;
      if (unchanged) {
        completed++;
        reused++;
        console.log(`  沿用快取 ${completed}/${audioCount}：${file.name}`);
        return { ...cached, scanId };
      }

      const folderArtworkId = await getFolderArtwork();
      let metadata: AudioMetadata = {};
      let metadataError: string | null = null;
      try {
        metadata = await withReadRetry(`解析 ${file.path}`, () => extractMetadata(dav, file.path, file.size));
      } catch (error) {
        metadataError = error instanceof Error ? error.message : String(error);
      }

      const { picture, lyrics: embeddedLyrics, ...preparedMetadata } = metadata;
      let trackArtworkId: string | null = null;
      if (picture?.data.length) {
        try {
          trackArtworkId = await addArtwork(artworks, artworkJobs, picture.data);
        } catch (error) {
          console.warn(`  略過內嵌封面 ${file.path}：${error instanceof Error ? error.message : String(error)}`);
        }
      }

      let lyrics: PreparedTrack['lyrics'] = null;
      if (lrcPath) {
        try {
          const content = (await withReadRetry(`讀取歌詞 ${lrcPath}`, () => dav.readText(lrcPath))).trim();
          if (content) lyrics = { content, source: 'lrc' };
        } catch (error) {
          console.warn(`  略過歌詞 ${lrcPath}：${error instanceof Error ? error.message : String(error)}`);
        }
      }
      if (!lyrics && embeddedLyrics) lyrics = { content: embeddedLyrics, source: 'embedded' };

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
        trackArtworkId,
        folderArtworkId,
      };
      completed++;
      console.log(`  本機解析 ${completed}/${audioCount}：${file.name}${metadataError ? `（${metadataError}）` : ''}`);
      return track;
  });
  tracks.push(...preparedTracks);

  const referencedArtwork = new Set(tracks.flatMap((track) => [track.trackArtworkId, track.folderArtworkId]).filter((id): id is string => !!id));
  console.log(`本機解析完成：${audioCount} 首；沿用 ${reused} 首，重新解析 ${audioCount - reused} 首`);

  return {
    version: 3,
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
    if (cached.version !== 3) throw new Error('本機同步快取版本不支援，請重新執行準備');
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
