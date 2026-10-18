const AMP_API = 'https://amp-api.music.apple.com/v1';
const APPLE_MUSIC_WEB = 'https://music.apple.com';
const APPLE_MUSIC_BOOTSTRAP = 'https://beta.music.apple.com';

export interface AppleArtwork {
  url: string;
  width: number;
  height: number;
}

export interface AppleMusicMatch {
  songId: string;
  isrc: string | null;
  title: string;
  artistName: string;
  artistId: string | null;
  artistArtwork: AppleArtwork | null;
  songArtwork: AppleArtwork | null;
  audioLocale: string | null;
  displayTitle: string | null;
  displayArtist: string | null;
  confidence: number;
  hasLyrics: boolean;
  hasTimeSyncedLyrics: boolean;
}

interface SearchInput {
  title: string;
  artist: string;
  album?: string;
  duration?: number;
  isrc?: string;
  /** The local file is a Dolby Atmos (E-AC-3) stream. */
  atmos?: boolean;
}

interface AppleSong {
  id: string;
  attributes?: {
    name?: string;
    artistName?: string;
    albumName?: string;
    durationInMillis?: number;
    isrc?: string;
    audioLocale?: string;
    audioTraits?: string[];
    contentRating?: string;
    artwork?: AppleArtwork;
    hasLyrics?: boolean;
    hasTimeSyncedLyrics?: boolean;
  };
  relationships?: {
    artists?: {
      data?: Array<{
        id?: string;
        attributes?: { name?: string; artwork?: AppleArtwork };
      }>;
    };
  };
}

interface AppleResponse {
  data?: Array<{ attributes?: { ttml?: string; ttmlLocalizations?: string | Record<string, string> } }>;
  results?: { songs?: { data?: AppleSong[] } };
  errors?: Array<{ title?: string; detail?: string; code?: string }>;
}

export interface AppleMusicOptions {
  developerToken?: string;
  mediaUserToken?: string;
  storefront?: string;
  lyricsStorefront?: string;
  language?: string;
}

const stripBearer = (value: string | undefined) => value?.trim().replace(/^Bearer\s+/i, '') || '';

function tokenExpiry(token: string): number | null {
  try {
    const payload = token.split('.')[1];
    if (!payload) return null;
    const normalized = payload.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(payload.length / 4) * 4, '=');
    const parsed = JSON.parse(Buffer.from(normalized, 'base64').toString('utf8')) as { exp?: number };
    return typeof parsed.exp === 'number' ? parsed.exp * 1000 : null;
  } catch {
    return null;
  }
}

function compact(value: string | undefined): string {
  return (value ?? '')
    .normalize('NFKC')
    .toLocaleLowerCase('en')
    .replace(/&/g, 'and')
    .replace(/[\p{P}\p{S}\s]+/gu, '');
}

function latinOnly(value: string): boolean {
  const letters = value.match(/\p{L}/gu) ?? [];
  return letters.length > 0 && letters.every((letter) => /\p{Script=Latin}/u.test(letter));
}

function containsCjk(value: string): boolean {
  return /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]/u.test(value);
}

function similarity(left: string | undefined, right: string | undefined): number {
  const a = compact(left);
  const b = compact(right);
  if (!a || !b) return 0;
  if (a === b) return 1;
  if (a.includes(b) || b.includes(a)) return Math.min(a.length, b.length) / Math.max(a.length, b.length);

  const pairs = (value: string) => {
    const out = new Map<string, number>();
    for (let i = 0; i < value.length - 1; i++) {
      const pair = value.slice(i, i + 2);
      out.set(pair, (out.get(pair) ?? 0) + 1);
    }
    return out;
  };
  if (a.length < 2 || b.length < 2) return 0;
  const aa = pairs(a);
  const bb = pairs(b);
  let overlap = 0;
  for (const [pair, count] of aa) overlap += Math.min(count, bb.get(pair) ?? 0);
  return (2 * overlap) / ([...aa.values()].reduce((sum, n) => sum + n, 0) + [...bb.values()].reduce((sum, n) => sum + n, 0));
}

const VERSION_MARKERS = [
  'live', 'acoustic', 'instrumental', 'karaoke', 'remix', 'remaster', 'remastered',
  'cover', 'englishversion', 'japaneseversion', 'radioedit', 'spedup', 'slowed',
];

function versionPenalty(input: string, candidate: string): number {
  const source = compact(input);
  const result = compact(candidate);
  return VERSION_MARKERS.reduce(
    (penalty, marker) => penalty + (source.includes(marker) !== result.includes(marker) ? 24 : 0),
    0,
  );
}

/**
 * Unbounded score so near-identical candidates stay distinguishable. A single
 * and its album re-release often share one ISRC but carry separately timed
 * TTML, so ISRC is a strong signal rather than an immediate win.
 */
function scoreSong(input: SearchInput, song: AppleSong, rank: number): number {
  const attrs = song.attributes ?? {};
  let score = Math.max(0, 18 - rank * 2);
  if (input.isrc && attrs.isrc) score += compact(input.isrc) === compact(attrs.isrc) ? 60 : -20;
  score += similarity(input.title, attrs.name) * 38;
  score += similarity(input.artist, attrs.artistName) * 24;
  score += similarity(input.album, attrs.albumName) * 10;
  if (input.album && compact(input.album) === compact(attrs.albumName)) score += 16;

  if (input.duration && attrs.durationInMillis) {
    const difference = Math.abs(input.duration - attrs.durationInMillis / 1000);
    score += difference <= 2.5 ? 38 - difference * 4 : difference <= 5 ? 27 : difference <= 10 ? 12 : difference <= 20 ? 2 : -24;
  }
  // A stereo file can come from an Atmos-capable release, but an Atmos file
  // cannot come from a release Apple has no Atmos mix for.
  if (input.atmos) score += attrs.audioTraits?.includes('atmos') ? 14 : -14;
  score -= versionPenalty(input.title, attrs.name ?? '');
  const compactTitle = compact(input.title);
  if (compactTitle.includes('explicit') && attrs.contentRating !== 'explicit') score -= 36;
  if (compactTitle.includes('clean') && attrs.contentRating === 'explicit') score -= 48;
  return score;
}

function localizedValue(original: string, localized: string, japanese: boolean): string | null {
  if (!japanese || !latinOnly(original) || !containsCjk(localized)) return null;
  return localized === original ? null : localized;
}

function responseMessage(payload: AppleResponse, status: number): string {
  const error = payload.errors?.[0];
  return error?.detail || error?.title || error?.code || `HTTP ${status}`;
}

async function delay(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

export class AppleMusicClient {
  readonly storefront: string;
  readonly lyricsStorefront: string;
  readonly language: string;
  readonly hasMediaUserToken: boolean;
  private providedDeveloperToken: string;
  private mediaUserToken: string;
  private bearerTokens: string[] = [];
  private bearerIndex = 0;
  private initialized = false;

  constructor(options: AppleMusicOptions = {}) {
    this.providedDeveloperToken = stripBearer(options.developerToken);
    this.mediaUserToken = stripBearer(options.mediaUserToken);
    this.hasMediaUserToken = !!this.mediaUserToken;
    this.storefront = (options.storefront || 'jp').toLowerCase();
    this.lyricsStorefront = (options.lyricsStorefront || this.storefront).toLowerCase();
    this.language = options.language || 'ja-JP';
  }

  async initialize(): Promise<void> {
    if (this.initialized) return;
    if (this.providedDeveloperToken) {
      this.bearerTokens = [this.providedDeveloperToken];
      this.initialized = true;
      return;
    }

    const page = await fetch(APPLE_MUSIC_BOOTSTRAP);
    if (!page.ok) throw new Error(`Apple Music 網頁載入失敗：HTTP ${page.status}`);
    const html = await page.text();
    const scripts = [...html.matchAll(/<script[^>]+src=["']([^"']+)/gi)]
      .map((match) => new URL(match[1], page.url).href)
      .sort((a, b) => Number(b.includes('index~')) - Number(a.includes('index~')));

    const found = new Set<string>();
    for (const script of scripts.slice(0, 12)) {
      const response = await fetch(script);
      if (!response.ok) continue;
      const body = await response.text();
      for (const token of body.match(/eyJ[a-zA-Z0-9_-]+\.[a-zA-Z0-9_-]+\.[a-zA-Z0-9_-]+/g) ?? []) {
        const expiry = tokenExpiry(token);
        if (expiry === null || expiry > Date.now() + 60_000) found.add(token);
      }
      if (found.size) break;
    }
    if (!found.size) throw new Error('Apple Music 網頁內找不到可用的開發者 Token');
    this.bearerTokens = [...found];
    this.initialized = true;
  }

  private async get(path: string, params: Record<string, string>, needsUser = false): Promise<AppleResponse> {
    await this.initialize();
    if (needsUser && !this.mediaUserToken) throw new Error('缺少 APPLE_MUSIC_USER_TOKEN');

    let lastError = 'Apple Music 請求失敗';
    for (let attempt = 0; attempt < Math.max(4, this.bearerTokens.length); attempt++) {
      const token = this.bearerTokens[this.bearerIndex % this.bearerTokens.length];
      const url = new URL(`${AMP_API}/${path.replace(/^\//, '')}`);
      for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);
      const headers: Record<string, string> = {
        accept: 'application/json',
        authorization: `Bearer ${token}`,
        origin: APPLE_MUSIC_WEB,
        referer: `${APPLE_MUSIC_WEB}/`,
      };
      // Public catalog searches do not need the subscriber credential. Sending
      // it across storefronts can make an otherwise public request return 403.
      if (needsUser && this.mediaUserToken) headers['media-user-token'] = this.mediaUserToken;

      const response = await fetch(url, { headers });
      const payload = await response.json().catch(() => ({})) as AppleResponse;
      if (response.ok) return payload;
      lastError = responseMessage(payload, response.status);
      if (response.status === 401 && this.bearerTokens.length > 1) {
        this.bearerIndex = (this.bearerIndex + 1) % this.bearerTokens.length;
        continue;
      }
      if (response.status === 429 || response.status >= 500) {
        await delay(700 * 2 ** Math.min(attempt, 3));
        continue;
      }
      if (needsUser && (response.status === 401 || response.status === 403 || response.status === 404)) {
        throw new Error(`Apple Music 歌詞無法存取：${lastError}`);
      }
      throw new Error(`Apple Music API：${lastError}`);
    }
    throw new Error(`Apple Music API：${lastError}`);
  }

  private async matchTrackAt(
    input: SearchInput,
    storefront: string,
    language: string,
  ): Promise<AppleMusicMatch | null> {
    const term = `${input.artist} ${input.title}`.trim();
    if (!term) return null;
    const payload = await this.get(`catalog/${storefront}/search`, {
      term,
      types: 'songs',
      limit: '10',
      l: language,
      'include[songs]': 'artists',
    });
    const candidates = payload.results?.songs?.data ?? [];
    const ranked = candidates
      .map((song, rank) => ({ song, score: scoreSong(input, song, rank) }))
      .sort((a, b) => b.score - a.score);
    const best = ranked[0];
    if (!best || best.score < 45) return null;

    let song = best.song;
    const japanese = (song.attributes?.audioLocale ?? '').toLowerCase().startsWith('ja');
    // A ja-JP catalog request transliterates Western credits into katakana
    // ("Camila Cabello" -> "カミラ・カベロ"). Only Japanese songs should carry
    // localized names, so re-read everything else in English.
    if (!japanese && language.toLowerCase().startsWith('ja')) {
      const original = await this.get(`catalog/${storefront}/songs/${song.id}`, {
        l: 'en-US',
        include: 'artists',
      }).catch(() => null);
      const originalSong = (original?.data as unknown as AppleSong[] | undefined)?.[0];
      if (originalSong?.attributes) song = originalSong;
    }

    const attrs = song.attributes ?? {};
    const artist = song.relationships?.artists?.data?.[0];
    const title = attrs.name?.trim() || input.title;
    const artistName = attrs.artistName?.trim() || artist?.attributes?.name?.trim() || input.artist;
    return {
      songId: song.id,
      isrc: attrs.isrc?.trim() || null,
      title,
      artistName,
      artistId: artist?.id?.trim() || null,
      artistArtwork: artist?.attributes?.artwork?.url ? artist.attributes.artwork : null,
      songArtwork: attrs.artwork?.url ? attrs.artwork : null,
      audioLocale: attrs.audioLocale?.trim() || null,
      displayTitle: localizedValue(input.title, title, japanese),
      displayArtist: localizedValue(input.artist, artistName, japanese),
      confidence: Math.min(100, Math.round(best.score)),
      hasLyrics: !!attrs.hasLyrics,
      hasTimeSyncedLyrics: !!attrs.hasTimeSyncedLyrics,
    };
  }

  async matchTrack(input: SearchInput): Promise<AppleMusicMatch | null> {
    return this.matchTrackAt(input, this.storefront, this.language);
  }

  /** Resolve the storefront-specific song ID used by the subscriber's account. */
  async matchLyricsTrack(input: SearchInput): Promise<AppleMusicMatch | null> {
    const identity = `${input.title} ${input.artist}`;
    const language = /[\p{Script=Hiragana}\p{Script=Katakana}]/u.test(identity)
      ? 'ja-JP'
      : /\p{Script=Han}/u.test(identity)
        ? 'zh-TW'
        : 'en-US';
    return this.matchTrackAt(input, this.lyricsStorefront, language);
  }

  async fetchLyrics(songId: string, audioLocale: string | null): Promise<string | null> {
    if (!this.mediaUserToken) return null;
    const locale = (audioLocale || '').toLowerCase();
    const lyricsLocale = locale.startsWith('ja') ? 'ja-jp' : locale.startsWith('zh') ? 'zh-hant' : 'en-us';
    const script = locale.startsWith('ja') ? 'ja-Jpan' : locale.startsWith('zh') ? 'zh-Hant' : 'en-Latn';
    const payload = await this.get(`catalog/${this.lyricsStorefront}/songs/${songId}/syllable-lyrics`, {
      'l[lyrics]': lyricsLocale,
      'l[script]': script,
      extend: 'ttmlLocalizations',
    }, true);
    const attributes = payload.data?.[0]?.attributes;
    const direct = attributes?.ttml;
    if (typeof direct === 'string' && direct.includes('<tt')) return direct.trim();
    const localizations = attributes?.ttmlLocalizations;
    if (typeof localizations === 'string' && localizations.includes('<tt')) return localizations.trim();
    if (localizations && typeof localizations === 'object') {
      const localized = Object.values(localizations).find((value) => typeof value === 'string' && value.includes('<tt'));
      if (localized) return localized.trim();
    }
    return null;
  }
}

export function appleArtworkUrl(template: string, size: number): string {
  return template
    .replace(/\{w\}/g, String(size))
    .replace(/\{h\}/g, String(size))
    .replace(/\{f\}/g, 'webp')
    .replace(/\.(?:jpg|jpeg|png)(?=\?|$)/i, '.webp');
}
