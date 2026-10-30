import { createHash, randomUUID } from 'node:crypto';
import { chmod, mkdir, readFile, rename, unlink, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import sharp from 'sharp';
import { type Aac51Pairing, type AlternateSource, aac51Root, pairAac51 } from '../apps/worker/src/lib/aac51';
import { ARTWORK_SIZES, type ArtworkSize } from '../apps/worker/src/lib/artwork';
import { AUDIO_EXTENSIONS, type AudioMetadata, METADATA_VERSION, extOf, extractMetadata, guessFromFilename } from '../apps/worker/src/lib/metadata';
import { type DavEntry, WebDAV, normalizePath, parentDir } from '../apps/worker/src/lib/webdav';
import {
  AppleMusicClient,
  appleArtworkUrl,
  localizedValue,
  type AppleArtwork,
  type AppleCredit,
  type AppleGenre,
  type AppleMusicMatch,
} from './apple-music';

const COVER_NAMES = ['cover', 'folder', 'front', 'album', 'albumart', 'albumcover', 'artwork', 'jacket', '封面', '專輯封面', '专辑封面'];
const IMAGE_EXT = ['jpg', 'jpeg', 'png', 'webp', 'avif', 'gif'];
const projectRoot = process.cwd();
// `--dev` uploads to the local `wrangler dev` server instead of the deployed
// site. The parsed library cache is shared; upload progress is kept apart so an
// interrupted dev upload never makes a production resume skip tracks.
const devTarget = process.argv.includes('--dev');
const cacheFile = resolve(projectRoot, '.sync-cache/library.json');
const uploadStateFile = resolve(projectRoot, `.sync-cache/upload-state${devTarget ? '.dev' : ''}.json`);
// PikPak occasionally returns a short-lived 404 while creating a fresh signed
// download URL. A repeated 404 is still treated as a real missing file.
const transientHttpError = /HTTP (?:404|408|425|429|500|502|503|504)\b/;
const dailyD1LimitError = /exceeded D1's free tier daily/i;
// Part of every track's sync hash. Bump it when /sync/import/track starts
// writing a payload differently, so every track is uploaded once more.
// Version 2 credits every artist of a song instead of one combined artist.
const TRACK_IMPORT_VERSION = 2;

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
  /** Parser version that produced metadata; older entries are parsed again for the fields added since. */
  metadataVersion?: number;
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
    /** Null when Apple carries no genre for the song. */
    genre?: AppleGenre | null;
    /** APPLE_GENRE_VERSION that produced `genre`; any other value is looked up again. */
    genreVersion?: number;
    /** Who Apple credits on the song and its album; null when the storefront does not carry the song. */
    credits?: {
      japanese: boolean;
      artists: CachedCredit[];
      albumArtists: CachedCredit[];
    } | null;
    /** APPLE_CREDITS_VERSION that produced `credits`; any other value is looked up again. */
    creditsVersion?: number;
  }) | null;
  appleCheckedAt: number | null;
  appleMatchVersion?: number;
  appleLyricsCheckedAt: number | null;
  trackArtworkId: string | null;
  folderArtworkId: string | null;
  aac51?: AlternateSource | null;
  /** Every artist the song credits, in credit order. Unset without Apple credits: the Worker files it under the tag. */
  artists?: ImportedArtist[];
  /** The album's own artists, shared by every track of the local album. Unset: the album artist tag. */
  albumArtists?: ImportedArtist[];
  /** Apple's genre, or the tag translated through Apple's names; metadata.genre keeps the tag. */
  displayGenre?: { zh: string | null; en: string };
}

/** An artist Apple credits, as cached with the match. */
interface CachedCredit {
  appleId: string;
  /** Apple's name in the song's language. */
  name: string;
  names: string[];
  artworkId: string | null;
}

/** One artist as /sync/import/track receives it; the name is the one the whole library agrees on. */
interface ImportedArtist {
  appleId: string;
  name: string;
  /** Other spellings seen in tags and at Apple, for search. */
  aliases: string[];
  artworkId: string | null;
  /** Apple's logo for the artist. Unset without one, so the tracks of most artists keep their sync hash. */
  logoId?: string;
  /** Apple's motion artwork for the artist. Unset without one, as logoId. */
  video?: ArtistVideo;
  /** Apple's 4:1 header image for the artist. Unset without one, as logoId. */
  bannerId?: string;
}

/** A motion artwork as the Worker stores it: Apple's HLS playlist, and a still of it in R2. */
interface ArtistVideo {
  url: string;
  previewId: string;
}

/** The top of an artist's Apple page as last looked up, keyed by Apple artist ID in the manifest. */
interface CachedArtistPage {
  /** Null when Apple has no logo for the artist. */
  logoId: string | null;
  video: ArtistVideo | null;
  /** Absent in entries looked up before banners were, which are looked up again. */
  bannerId?: string | null;
  checkedAt: number;
}

interface SyncManifest {
  version: 5;
  createdAt: string;
  root: string;
  scanId: string;
  artworks: PreparedArtwork[];
  tracks: PreparedTrack[];
  /** Absent in manifests written before artist pages were looked up. */
  artistPages?: Record<string, CachedArtistPage>;
}

interface UploadState {
  scanId: string;
  artworkIndex: number;
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
  return { scanId, artworkIndex: 0 };
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
const DOLBY_ATMOS_CODECS = new Set(['ec-3', 'eac3', 'e-ac-3']);
// Bump when Apple Music scoring changes so cached matches (and the TTML they
// selected) are re-resolved once instead of waiting for the refresh interval.
const APPLE_MATCH_VERSION = 3;
// Bump when the genre lookup changes so cached genres are looked up again.
// Version 2 reads subgenres ("Mandopop"), which version 1 folded into "Pop";
// version 3 finds songs Taiwan lists under another ID by ISRC.
const APPLE_GENRE_VERSION = 3;
// Bump when the credit lookup changes so cached credits are looked up again.
// Version 2 finds songs Apple re-issued under a new ID by their ISRC.
const APPLE_CREDITS_VERSION = 2;

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
      const response = await fetch(appleArtworkUrl(artwork, size));
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

/**
 * Pair each track with the AAC 5.1 file of the same name. A name shared by two
 * originals cannot be resolved and is skipped rather than guessed. When the
 * folder could not be read at all, the previous pairing is kept.
 */
function attachAac51(
  tracks: PreparedTrack[],
  altFiles: AlternateSource[] | null,
  previousByPath: Map<string, PreparedTrack>,
): Aac51Pairing | null {
  if (!altFiles) {
    for (const track of tracks) track.aac51 = previousByPath.get(track.path)?.aac51 ?? null;
    return null;
  }
  const pairing = pairAac51(tracks.map((track) => track.path), altFiles);
  for (const track of tracks) track.aac51 = pairing.pairs.get(track.path) ?? null;
  return pairing;
}

const nfc = (value: string | null | undefined) => (value ?? '').normalize('NFC');

/** Credit separators in tags: "A & B", "A, B, & C", "A、B", "Coldplay X BTS". A slash belongs to names ("HUNTR/X"). */
const CREDIT_SEPARATOR = /\s*(?:,\s*&|,|&|、|\s[xX×]\s)\s*/;
const creditKey = (value: string) => value.normalize('NFKC').toLocaleLowerCase('en').replace(/[\p{P}\p{S}\s]+/gu, '');

/**
 * The tag's own spelling of each credited artist, so a page reads "王謙Goatak"
 * or "伍佰 & China Blue" rather than Apple's romanized "Goatak" / "Wu Bai &
 * China Blue". Null where the tag does not name the artist, such as the
 * remixer Apple credits on a remix tagged with the original artist only.
 */
function tagCreditNames(tag: string, credits: CachedCredit[]): (string | null)[] {
  const parts = tag.split(CREDIT_SEPARATOR).map((part) => part.trim()).filter(Boolean);
  const keys = parts.map(creditKey);
  const known = credits.map((credit) => credit.names.map(creditKey).filter(Boolean));
  if (credits.length === 1) {
    // One act: the whole tag names it, unless the tag also lists a feat. guest
    // that Apple leaves out ("Jung Kook & Latto" on "Seven (feat. Latto)").
    const exact = parts.length > 1 ? parts.find((_, index) => known[0].includes(keys[index])) : undefined;
    return [exact ?? (tag.trim() || null)];
  }
  const names: (string | null)[] = credits.map(() => null);
  const used = new Set<number>();
  const claim = (matches: (key: string, own: string[]) => boolean) => {
    credits.forEach((_, credit) => {
      if (names[credit] !== null) return;
      const part = keys.findIndex((key, index) => !used.has(index) && !!key && matches(key, known[credit]));
      if (part < 0) return;
      used.add(part);
      names[credit] = parts[part];
    });
  };
  claim((key, own) => own.includes(key));
  // "Lilas Ikuta" for Apple's "Lilas", "Sabrina 胡恂舞" for "Sabrina".
  claim((key, own) => own.some((name) => name.length > 1 && key.length > 1 && (key.includes(name) || name.includes(key))));
  // What is left pairs up in order when the counts agree ("菲道爾" for "Firdhaus").
  const leftParts = parts.filter((_, index) => !used.has(index));
  const leftCredits = names.flatMap((name, credit) => name === null ? [credit] : []);
  if (leftParts.length === leftCredits.length) leftCredits.forEach((credit, index) => { names[credit] = leftParts[index]; });
  return names;
}

/**
 * Credit every artist Apple lists on a song or album. Apple decides who is
 * credited; the tags decide how each name is spelled. An artist tagged several
 * ways ("Riria." / "りりあ。") takes the spelling most of the library uses,
 * counting their own songs first so a guest spot ("Hikaru Utada" on a Charlie
 * Puth song) cannot outvote them; the other spellings stay searchable. A local
 * album takes the artists most of its tracks' Apple albums credit, so a single
 * and the album release of one song cannot split it.
 */
async function attachCredits(
  tracks: PreparedTrack[],
  apple: AppleMusicClient | null,
  root: string,
  addArtistArtwork: (artwork: AppleArtwork) => Promise<string | null>,
): Promise<void> {
  const pending = tracks.filter((track) => track.appleMusic && track.appleMusic.creditsVersion !== APPLE_CREDITS_VERSION);
  if (apple && pending.length) {
    try {
      const songs = await apple.songCredits(pending.map((track) => ({
        songId: track.appleMusic!.songId,
        isrc: track.appleMusic!.isrc ?? track.metadata.isrc ?? null,
      })));
      const albumIds = new Set([...songs.values()].flatMap((song) => song.albumId ? [song.albumId] : []));
      const japaneseAlbums = new Set([...songs.values()].flatMap((song) => song.japanese && song.albumId ? [song.albumId] : []));
      const albums = await apple.albumCredits([...albumIds], japaneseAlbums);
      const artworks = new Map<string, AppleArtwork>();
      for (const credit of [...[...songs.values()].flatMap((song) => song.artists), ...[...albums.values()].flat()]) {
        if (credit.artwork && !artworks.has(credit.id)) artworks.set(credit.id, credit.artwork);
      }
      const artworkIds = new Map(await mapConcurrent([...artworks], 4, async ([id, artwork]) => [id, await addArtistArtwork(artwork)] as const));
      const cache = (credit: AppleCredit): CachedCredit => ({
        appleId: credit.id,
        name: nfc(credit.name),
        names: credit.names.map(nfc),
        artworkId: artworkIds.get(credit.id) ?? null,
      });
      for (const track of pending) {
        const song = songs.get(track.appleMusic!.songId);
        track.appleMusic!.credits = song ? {
          japanese: song.japanese,
          artists: song.artists.map(cache),
          albumArtists: (song.albumId ? albums.get(song.albumId) : undefined)?.map(cache) ?? [],
        } : null;
        track.appleMusic!.creditsVersion = APPLE_CREDITS_VERSION;
      }
      console.log(`  Apple Music 歌手：查詢 ${pending.length} 首`);
    } catch (error) {
      warnOnce('apple-credits', `  Apple Music 歌手暫停，下次同步再補：${error instanceof Error ? error.message : String(error)}`);
    }
  }

  const tagArtist = (track: PreparedTrack) =>
    nfc(track.metadata.artist || guessFromFilename(track.path).artist || track.metadata.albumArtist);
  interface Tally {
    own: Map<string, number>;
    all: Map<string, number>;
    /** Apple's own names, which settle a tie. */
    apple: Set<string>;
    aliases: Set<string>;
    artworkId: string | null;
  }
  const tallies = new Map<string, Tally>();
  const count = (credits: CachedCredit[], tag: string, japanese: boolean) => {
    const spelled = tagCreditNames(tag, credits);
    credits.forEach((credit, index) => {
      const name = spelled[index] ?? credit.name;
      const shown = localizedValue(name, credit.name, japanese) ?? name;
      let tally = tallies.get(credit.appleId);
      if (!tally) {
        tally = { own: new Map(), all: new Map(), apple: new Set(), aliases: new Set(), artworkId: null };
        tallies.set(credit.appleId, tally);
      }
      for (const votes of credits.length === 1 ? [tally.own, tally.all] : [tally.all]) votes.set(shown, (votes.get(shown) ?? 0) + 1);
      for (const alias of credit.names) tally.apple.add(alias);
      for (const alias of [name, ...credit.names]) tally.aliases.add(alias);
      tally.artworkId ??= credit.artworkId;
    });
  };

  // Grouped as the Worker groups albums by their tags.
  const albums = new Map<string, PreparedTrack[]>();
  for (const track of tracks) {
    const meta = track.metadata;
    const folder = parentDir(track.path);
    const folderName = folder === root ? '' : folder.slice(folder.lastIndexOf('/') + 1);
    const artist = nfc(meta.artist || guessFromFilename(track.path).artist || meta.albumArtist ||
      track.appleMusic?.artistName.trim() || '未知歌手');
    const key = `${nfc(meta.album || folderName || '未知專輯').toLowerCase()}\u0000${(nfc(meta.albumArtist) || artist).toLowerCase()}`;
    albums.set(key, [...albums.get(key) ?? [], track]);
  }
  const albumCredits = new Map<PreparedTrack, CachedCredit[]>();
  for (const group of albums.values()) {
    const lists = new Map<string, { credits: CachedCredit[]; count: number }>();
    for (const track of group) {
      const credits = track.appleMusic?.credits?.albumArtists;
      if (!credits?.length) continue;
      const key = credits.map((credit) => credit.appleId).join(',');
      const list = lists.get(key) ?? { credits, count: 0 };
      list.count++;
      lists.set(key, list);
    }
    const best = [...lists.values()].sort((a, b) => b.count - a.count)[0];
    if (!best) continue;
    count(best.credits, nfc(group[0].metadata.albumArtist) || tagArtist(group[0]),
      group.some((track) => track.appleMusic?.credits?.japanese));
    for (const track of group) albumCredits.set(track, best.credits);
  }
  for (const track of tracks) {
    const credits = track.appleMusic?.credits;
    if (credits?.artists.length) count(credits.artists, tagArtist(track), credits.japanese);
  }

  const winner = (votes: Map<string, number>, apple: Set<string>) => [...votes]
    .sort((a, b) => b[1] - a[1] || Number(apple.has(b[0])) - Number(apple.has(a[0])) || a[0].localeCompare(b[0]))[0]?.[0];
  const identities = new Map<string, ImportedArtist>();
  const identity = (credit: CachedCredit): ImportedArtist => {
    let artist = identities.get(credit.appleId);
    if (!artist) {
      const tally = tallies.get(credit.appleId)!;
      const name = winner(tally.own, tally.apple) ?? winner(tally.all, tally.apple)!;
      artist = { appleId: credit.appleId, name, aliases: [...tally.aliases].filter((alias) => alias !== name).sort(), artworkId: tally.artworkId };
      identities.set(credit.appleId, artist);
    }
    return artist;
  };
  for (const track of tracks) {
    // Written by syncs from before each artist was credited separately.
    delete (track as { albumArtistApple?: unknown }).albumArtistApple;
    const credits = track.appleMusic?.credits?.artists;
    // Left unset otherwise, so tracks it does not concern keep their sync hash.
    if (credits?.length) track.artists = credits.map(identity);
    else delete track.artists;
    const album = albumCredits.get(track);
    if (album) track.albumArtists = album.map(identity);
    else delete track.albumArtists;
  }
}

/**
 * Give every credited artist the logo, motion artwork and banner Apple shows
 * at the top of their page. Apple adds them over time, so each artist is
 * looked up again after the refresh interval, in a few batched requests. The
 * video stays on Apple's CDN; only its still is saved. An artist whose images
 * fail to download keeps what was recorded before, so the next sync tries
 * again.
 */
async function attachArtistPages(
  tracks: PreparedTrack[],
  apple: AppleMusicClient | null,
  previous: Record<string, CachedArtistPage> | undefined,
  artworks: Map<string, PreparedArtwork>,
  addArtwork: (artwork: AppleArtwork) => Promise<string | null>,
): Promise<Record<string, CachedArtistPage>> {
  const credited = (track: PreparedTrack) => [...track.artists ?? [], ...track.albumArtists ?? []];
  const ids = new Set(tracks.flatMap((track) => credited(track).map((artist) => artist.appleId)));
  const pages: Record<string, CachedArtistPage> = {};
  for (const id of ids) {
    const page = previous?.[id];
    if (page && [page.logoId, page.video?.previewId, page.bannerId].every((artworkId) => !artworkId || artworks.has(artworkId))) pages[id] = page;
  }
  const stale = [...ids].filter((id) =>
    !pages[id] || pages[id].bannerId === undefined || Date.now() - pages[id].checkedAt >= refreshInterval());
  if (apple && stale.length) {
    try {
      const found = await apple.artistPages(stale);
      const checkedAt = Date.now();
      await mapConcurrent(stale, 4, async (id) => {
        const { logo, video, banner } = found.get(id) ?? { logo: null, video: null, banner: null };
        const logoId = logo ? await addArtwork(logo) : null;
        const previewId = video ? await addArtwork(video.preview) : null;
        const bannerId = banner ? await addArtwork(banner) : null;
        if (!!logo !== !!logoId || !!video !== !!previewId || !!banner !== !!bannerId) return;
        pages[id] = { logoId, video: video && previewId ? { url: video.url, previewId } : null, bannerId, checkedAt };
      });
      console.log(`  Apple Music 歌手 logo、動態背景與橫幅：查詢 ${stale.length} 位`);
    } catch (error) {
      warnOnce('apple-artist-pages', `  Apple Music 歌手 logo、動態背景與橫幅暫停，下次同步再補：${error instanceof Error ? error.message : String(error)}`);
    }
  }
  for (const artist of tracks.flatMap(credited)) {
    const page = pages[artist.appleId];
    if (page?.logoId) artist.logoId = page.logoId;
    else delete artist.logoId;
    if (page?.video) artist.video = page.video;
    else delete artist.video;
    if (page?.bannerId) artist.bannerId = page.bannerId;
    else delete artist.bannerId;
  }
  return pages;
}

const genreKey = (name: string) => name.normalize('NFKC').toLocaleLowerCase('en').replace(/[\s_-]+/g, '');

/**
 * Tags name one genre in several languages ("J-Pop" / "日本流行樂"), so Apple's
 * genre wins. Matched songs missing one are looked up in a few batched requests.
 * A genre with only an English name (the song is not sold in Taiwan), or an
 * unmatched track's tag, is translated through the pairs Apple gave the rest of
 * the library; a name Apple never used is left as is.
 */
async function attachGenres(tracks: PreparedTrack[], apple: AppleMusicClient | null): Promise<void> {
  const pending = tracks.filter((track) => track.appleMusic && track.appleMusic.genreVersion !== APPLE_GENRE_VERSION);
  if (apple && pending.length) {
    try {
      const songs = new Map(pending.map((track) => [track.appleMusic!.songId, {
        songId: track.appleMusic!.songId,
        isrc: track.appleMusic!.isrc ?? track.metadata.isrc ?? null,
      }]));
      const genres = await apple.songGenres([...songs.values()]);
      for (const track of pending) {
        track.appleMusic!.genre = genres.get(track.appleMusic!.songId) ?? null;
        track.appleMusic!.genreVersion = APPLE_GENRE_VERSION;
      }
      console.log(`  Apple Music 曲風：查詢 ${pending.length} 首`);
    } catch (error) {
      warnOnce('apple-genre', `  Apple Music 曲風暫停，下次同步再補：${error instanceof Error ? error.message : String(error)}`);
    }
  }

  const known = new Map<string, AppleGenre>();
  for (const track of tracks) {
    const genre = track.appleMusic?.genre;
    if (!genre?.zh) continue;
    for (const name of [genre.zh, genre.en]) known.set(genreKey(name), genre);
  }
  for (const track of tracks) {
    const appleGenre = track.appleMusic?.genre;
    const tag = track.metadata.genre?.trim();
    const translated = appleGenre?.zh ? undefined : known.get(genreKey(appleGenre?.en ?? tag ?? ''));
    const genre = translated ?? appleGenre;
    // Left unset otherwise, so tracks without a genre keep their sync hash.
    if (genre) track.displayGenre = { zh: genre.zh, en: genre.en };
    else delete track.displayGenre;
  }
}

function reportAac51(paired: number, ambiguous: string[], orphans: string[]): void {
  console.log(`  AAC 5.1 配對：${paired} 首`);
  if (ambiguous.length) {
    console.warn(`  AAC 5.1 檔名重複，無法判斷對應哪一首，已略過 ${ambiguous.length} 個：${ambiguous.slice(0, 5).join('、')}`);
  }
  if (orphans.length) {
    console.warn(`  AAC 5.1 找不到同名原檔 ${orphans.length} 個：${orphans.slice(0, 5).join('、')}`);
  }
}

/** Every m4a under the AAC 5.1 folder; throws when the folder cannot be read. */
async function listAac51Files(dav: WebDAV, altRoot: string): Promise<AlternateSource[]> {
  const folders = [altRoot];
  const files: AlternateSource[] = [];
  while (folders.length) {
    const dir = folders.shift()!;
    for (const entry of await withReadRetry(`掃描 ${dir}`, () => dav.list(dir))) {
      if (entry.isDir) {
        if (entry.path !== dir) folders.push(entry.path);
      } else if (extOf(entry.name) === 'm4a') {
        files.push({ path: entry.path, size: entry.size, etag: entry.etag });
      }
    }
  }
  return files;
}

function connectWebDAV(): WebDAV {
  return new WebDAV({
    WEBDAV_URL: required('WEBDAV_URL'),
    MUSIC_ROOT: process.env.MUSIC_ROOT?.trim() || '/',
    WEBDAV_USERNAME: process.env.WEBDAV_USERNAME,
    WEBDAV_PASSWORD: process.env.WEBDAV_PASSWORD,
    WEBDAV_BEARER_TOKEN: process.env.WEBDAV_BEARER_TOKEN,
    WEBDAV_AUTH_MODE: process.env.WEBDAV_AUTH_MODE as 'auto' | 'basic' | 'bearer' | undefined,
  } as never);
}

async function prepare(): Promise<SyncManifest> {
  const dav = connectWebDAV();
  const root = normalizePath(process.env.MUSIC_ROOT?.trim() || '/');
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

  const altRoot = aac51Root(process.env.AAC51_ROOT);
  const insideAltRoot = (path: string) => path === altRoot || path.startsWith(`${altRoot}/`);
  let altFiles: AlternateSource[] | null = null;
  try {
    altFiles = await listAac51Files(dav, altRoot);
    console.log(`  AAC 5.1 資料夾：${altFiles.length} 個檔案`);
  } catch (error) {
    warnOnce('aac51-root', `  無法讀取 ${altRoot}，本次沿用上次的 AAC 5.1 配對：${error instanceof Error ? error.message : String(error)}`);
  }

  console.log(`本機掃描 ${root}（並行 ${concurrency}）`);
  while (folders.length) {
    const batch = folders.splice(0, concurrency);
    const listed = await Promise.all(batch.map(async (dir) => ({
      dir,
      entries: await withReadRetry(`掃描 ${dir}`, () => dav.list(dir)),
    })));
    for (const { dir, entries } of listed) {
      for (const entry of entries) {
        // AAC 5.1 copies are attached to their originals, never listed as songs of their own.
        if (entry.isDir && insideAltRoot(entry.path)) continue;
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
      // Re-read the tags of unchanged files once the parsers learn new fields; artwork stays cached.
      const metadataCurrent = cached?.metadataVersion === METADATA_VERSION;
      const cachedGuess = cached ? guessFromFilename(cached.path) : null;
      const cachedNeedsArtistRecovery = !!cached && !cached.appleMusic &&
        !(cached.metadata.artist || cached.metadata.albumArtist || cachedGuess?.artist);
      const cachedAppleLocale = (cached?.appleMusic?.audioLocale ?? '').toLowerCase();
      // Earlier syncs stored ja-JP transliterations for non-Japanese songs. An
      // instrumental ("zxx") takes its album's language, so katakana is expected there.
      const cachedAppleNameLocalized = !!cached?.appleMusic &&
        !cachedAppleLocale.startsWith('ja') && cachedAppleLocale !== 'zxx' &&
        /\p{Script=Katakana}/u.test(`${cached.appleMusic.artistName}${cached.appleMusic.title}`);
      // Version 3 only changed how instrumentals pick their language.
      const cachedAppleMatchCurrent = cached?.appleMatchVersion === APPLE_MATCH_VERSION ||
        cached?.appleMatchVersion === 2 && cachedAppleLocale !== 'zxx';
      const appleFresh = !apple || !cachedNeedsArtistRecovery && !cachedAppleNameLocalized && cachedAppleMatchCurrent &&
        !!cached?.appleCheckedAt && Date.now() - cached.appleCheckedAt < refreshInterval();
      // An edited TTML or LRC keeps its path but not its signature, so it is read again.
      // A TTML saved from Apple Music is signed with its content hash (see cachedLyricsSigned).
      const cachedLyricsReusable = !!cached?.lyrics && cached.lrcPath === currentLyricsPath && (
        !hasStableSignature(currentLyricsFile) || !currentLyricsFile ||
        cached.lrcSignature === currentLyricsSignature ||
        cached.lrcSignature === sha256(Buffer.from(cached.lyrics.content))
      );
      const lyricsReady = !apple?.hasMediaUserToken || !!cached?.lyrics || !!currentLyricsFile ||
        !cached?.appleMusic?.hasTimeSyncedLyrics || !!cached.appleLyricsCheckedAt;
      const unchanged = audioUnchanged && metadataCurrent && appleFresh && lyricsReady &&
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
      if (audioUnchanged && metadataCurrent) {
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
      let appleMatchVersion = cached?.appleMatchVersion;
      let appleLyricsCheckedAt = cached?.appleLyricsCheckedAt ?? null;
      // Set when the Apple lyrics song must be resolved again, so a TTML timed
      // for a different release is not carried over from the cache.
      let appleLyricsStale = false;
      const atmos = DOLBY_ATMOS_CODECS.has((preparedMetadata.codec ?? '').toLowerCase());
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
            atmos,
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
          const previous = cached?.appleMusic;
          const keepLyricsSong = !!match && cachedAppleMatchCurrent && previous?.songId === match.songId;
          appleLyricsStale = !keepLyricsSong;
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
              lyricsSongId: keepLyricsSong ? previous!.lyricsSongId : null,
              lyricsAudioLocale: keepLyricsSong ? previous!.lyricsAudioLocale : null,
              lyricsHasTimeSyncedLyrics: keepLyricsSong ? previous!.lyricsHasTimeSyncedLyrics : null,
              ...(previous?.songId === match.songId
                ? {
                    genre: previous.genre,
                    genreVersion: previous.genreVersion,
                    credits: previous.credits,
                    creditsVersion: previous.creditsVersion,
                  }
                : {}),
            };
          } else {
            appleMusic = null;
          }
          appleCheckedAt = Date.now();
          appleMatchVersion = APPLE_MATCH_VERSION;
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
      // The same file with the same signature holds the same text; reading it again only
      // costs PikPak another download link, which is what trips its 404 throttling.
      // A TTML this script saved from Apple Music is recorded with a hash of its content,
      // since PikPak's etag is unknown right after upload; trust it and adopt the etag.
      const cachedLyricsSigned = !!cached?.lyrics && !!cached.lrcSignature && (
        cached.lrcSignature === lrcSignature ||
        cached.lrcSignature === sha256(Buffer.from(cached.lyrics.content))
      );
      const lyricsFileUnchanged = !!lyricsFile && cachedLyricsSigned && hasStableSignature(lyricsFile) &&
        cached!.lrcPath === lyricsFile.path;
      if (lyricsFileUnchanged) {
        lyrics = cached!.lyrics;
      } else if (lyricsFile) {
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
      if (!lyrics && cached?.lyrics && !(appleLyricsStale && cached.lyrics.source === 'apple-music')) {
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
              atmos,
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
      // The re-resolved song had no usable TTML (or Apple failed this run):
      // slightly offset lyrics are still better than none.
      if (!lyrics && cached?.lyrics?.source === 'apple-music' && appleLyricsStale) {
        lyrics = cached.lyrics;
        lrcPath = cached.lrcPath;
        lrcSignature = cached.lrcSignature;
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
        metadataVersion: metadataError ? cached?.metadataVersion : METADATA_VERSION,
        lyrics,
        appleMusic,
        appleCheckedAt,
        appleMatchVersion,
        appleLyricsCheckedAt,
        trackArtworkId,
        folderArtworkId,
      };
      completed++;
      console.log(`  本機解析 ${completed}/${audioCount}：${file.name}${metadataError ? `（${metadataError}）` : ''}`);
      return track;
  });
  tracks.push(...preparedTracks);
  await attachCredits(tracks, apple, root, (artwork) => addAppleArtwork(artworks, appleArtworkJobs, artwork));
  const artistPages = await attachArtistPages(tracks, apple, previous?.artistPages, artworks,
    (artwork) => addAppleArtwork(artworks, appleArtworkJobs, artwork));
  await attachGenres(tracks, apple);
  const pairing = attachAac51(tracks, altFiles, previousByPath);
  if (pairing) reportAac51(pairing.pairs.size, pairing.ambiguous, pairing.orphans);

  const referencedArtwork = new Set(tracks.flatMap((track) => [
    track.trackArtworkId,
    track.folderArtworkId,
    track.appleMusic?.artistArtworkId,
    ...[...track.appleMusic?.credits?.artists ?? [], ...track.appleMusic?.credits?.albumArtists ?? []]
      .map((credit) => credit.artworkId),
    ...[...track.artists ?? [], ...track.albumArtists ?? []].flatMap((artist) => [artist.logoId, artist.video?.previewId, artist.bannerId]),
  ]).filter((id): id is string => !!id));
  console.log(`本機解析完成：${audioCount} 首；沿用 ${reused} 首，重新解析 ${audioCount - reused} 首`);

  return {
    version: 5,
    createdAt: new Date().toISOString(),
    root,
    scanId,
    artworks: [...artworks.values()].filter((artwork) => referencedArtwork.has(artwork.id)),
    tracks,
    artistPages,
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

/** In `--dev` mode a `DEV_`-prefixed variable wins, falling back to the deployed-site value. */
function syncSetting(name: string): string {
  if (devTarget) {
    const value = process.env[`DEV_${name}`]?.trim();
    if (value) return value;
  }
  return required(name);
}

async function login(baseUrl: string): Promise<string> {
  let lastError = '';
  for (let attempt = 0; attempt < 5; attempt++) {
    try {
      const response = await fetch(`${baseUrl}/api/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: syncSetting('SYNC_ADMIN_USERNAME'), password: syncSetting('SYNC_ADMIN_PASSWORD') }),
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

function targetUrl(): string {
  const configured = devTarget
    ? process.env.DEV_SYNC_TARGET_URL?.trim() || 'http://127.0.0.1:8787'
    : process.env.SYNC_TARGET_URL?.trim() || 'https://music.ascooo.com';
  const baseUrl = configured.replace(/\/$/, '');
  const target = new URL(baseUrl);
  if (target.protocol !== 'https:' && !['localhost', '127.0.0.1'].includes(target.hostname)) {
    throw new Error(`${devTarget ? 'DEV_' : ''}SYNC_TARGET_URL 必須使用 HTTPS（本機 localhost 除外）`);
  }
  return baseUrl;
}

/**
 * `--aac51-only`: re-pair AAC 5.1 copies from one listing of their folder,
 * without parsing or uploading any track. The Worker matches the names
 * against D1, so the result does not depend on how fresh the local cache is.
 */
async function syncAac51Only() {
  const altRoot = aac51Root(process.env.AAC51_ROOT);
  console.log(`掃描 ${altRoot}`);
  const files = await listAac51Files(connectWebDAV(), altRoot);
  console.log(`  AAC 5.1 資料夾：${files.length} 個檔案`);

  const baseUrl = targetUrl();
  console.log(`登入 ${baseUrl}`);
  const cookie = await login(baseUrl);
  const result = await post(baseUrl, cookie, '/sync/aac51', { files }) as {
    paired: number;
    changed: number;
    ambiguous: string[];
    orphans: string[];
  };
  reportAac51(result.paired, result.ambiguous, result.orphans);

  // Keep the cache in step so a later --upload-only does not restore the old pairing.
  const manifest = await previousManifest(normalizePath(process.env.MUSIC_ROOT?.trim() || '/'));
  if (manifest) {
    attachAac51(manifest.tracks, files, new Map());
    await persistManifest(manifest);
  }
  console.log(`AAC 5.1 同步完成：${result.changed ? `更新 ${result.changed} 首` : '沒有需要更新的歌曲'}`);
}

/** JSON with sorted keys, so a track read back from the cache hashes the same as a freshly parsed one. */
function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort()
      .filter((key) => (value as Record<string, unknown>)[key] !== undefined)
      .map((key) => `${JSON.stringify(key)}:${canonicalJson((value as Record<string, unknown>)[key])}`)
      .join(',')}}`;
  }
  return JSON.stringify(value);
}

/**
 * Hash of what the Worker would write for a track. Fields that only steer the
 * local cache (scan id, Apple re-check times) are left out, so a refresh that
 * finds the same match does not upload the track again.
 */
function trackSyncHash(track: PreparedTrack): string {
  const { scanId: _scanId, appleCheckedAt: _appleCheckedAt, appleLyricsCheckedAt: _appleLyricsCheckedAt, ...payload } = track;
  return createHash('sha256')
    .update(canonicalJson({ importVersion: TRACK_IMPORT_VERSION, metadataVersion: METADATA_VERSION, payload }))
    .digest('hex');
}

/** Ask the Worker for the hash of every imported track; null (e.g. an older Worker) means upload them all. */
async function syncedTrackHashes(baseUrl: string, cookie: string): Promise<Map<string, string> | null> {
  try {
    const { hashes } = await post(baseUrl, cookie, '/sync/import/track/hashes', {}) as { hashes: Record<string, string> };
    return new Map(Object.entries(hashes));
  } catch (error) {
    console.warn(`  無法查詢線上歌曲狀態，改為全部上傳：${error instanceof Error ? error.message : String(error)}`);
    return null;
  }
}

/** Ask the Worker which artworks R2 lacks; on failure (e.g. an older Worker) send them all. */
async function missingArtwork(baseUrl: string, cookie: string, artworks: PreparedArtwork[]): Promise<Set<string>> {
  const ids = artworks.map((artwork) => artwork.id);
  if (!ids.length) return new Set();
  try {
    const { missing } = await post(baseUrl, cookie, '/sync/import/artwork/missing', { ids }) as { missing: string[] };
    return new Set(missing);
  } catch (error) {
    console.warn(`  無法查詢 R2 既有封面，改為全部上傳：${error instanceof Error ? error.message : String(error)}`);
    return new Set(ids);
  }
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
  const baseUrl = targetUrl();
  console.log(`登入 ${baseUrl}`);
  const cookie = await login(baseUrl);
  const state = await loadUploadState(manifest.scanId);
  if (state.artworkIndex) console.log(`續傳進度：封面 ${state.artworkIndex}/${manifest.artworks.length}`);

  if (state.artworkIndex < manifest.artworks.length) {
    const missing = await missingArtwork(baseUrl, cookie, manifest.artworks.slice(state.artworkIndex));
    console.log(`  封面：${manifest.artworks.length - state.artworkIndex - missing.size} 張已在 R2，需上傳 ${missing.size} 張`);
    let sent = 0;
    for (let index = state.artworkIndex; index < manifest.artworks.length; index++) {
      const artwork = manifest.artworks[index];
      if (!missing.has(artwork.id)) continue;
      await post(baseUrl, cookie, '/sync/import/artwork', artwork);
      state.artworkIndex = index + 1;
      await persistUploadState(state);
      console.log(`  上傳封面 ${++sent}/${missing.size}`);
    }
    state.artworkIndex = manifest.artworks.length;
    await persistUploadState(state);
  }
  // D1 keeps the hash of each imported payload, so an interrupted upload resumes
  // where it stopped and a sync with no changes writes nothing.
  const synced = await syncedTrackHashes(baseUrl, cookie);
  const pending = manifest.tracks
    .map((track) => ({ ...track, syncHash: trackSyncHash(track) }))
    .filter((track) => synced?.get(track.path) !== track.syncHash);
  console.log(`  歌曲：${manifest.tracks.length - pending.length} 首未變更，需上傳 ${pending.length} 首`);
  for (let index = 0; index < pending.length; index++) {
    const track = pending[index];
    await post(baseUrl, cookie, '/sync/import/track', track);
    console.log(`  上傳歌曲 ${index + 1}/${pending.length}：${track.path.slice(track.path.lastIndexOf('/') + 1)}`);
  }

  await post(baseUrl, cookie, '/sync/finalize', {
    scanId: manifest.scanId,
    dir: manifest.root,
    artworkIds: manifest.artworks.map((artwork) => artwork.id),
    // Skipped tracks keep an older scan_id; an older Worker that ignores this
    // list is never reached with skipped tracks, since its hash lookup fails.
    paths: manifest.tracks.map((track) => track.path),
  });
  await clearUploadState();
  console.log(`同步完成：${manifest.tracks.length} 首歌曲（上傳 ${pending.length} 首）、${manifest.artworks.length} 張封面`);
}

async function main() {
  await loadLocalEnvironment();
  if (process.argv.includes('--aac51-only')) return syncAac51Only();
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
