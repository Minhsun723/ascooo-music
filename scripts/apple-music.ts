const AMP_API = 'https://amp-api.music.apple.com/v1';
const APPLE_MUSIC_WEB = 'https://music.apple.com';
const APPLE_MUSIC_BOOTSTRAP = 'https://beta.music.apple.com';
const ITUNES_LOOKUP = 'https://itunes.apple.com/lookup';
// Taiwan's catalog names genres in Traditional Chinese, or in English with lang=en_us.
const GENRE_STOREFRONT = 'tw';

export interface AppleArtwork {
  url: string;
  width: number;
  height: number;
}

export interface AppleGenre {
  /** Name in the Taiwan catalog; null when that catalog does not carry the song. */
  zh: string | null;
  en: string;
}

interface ITunesLookup {
  results?: Array<{ trackId?: number; primaryGenreName?: string }>;
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

/** One artist a song or album credits, in Apple's credit order. */
export interface AppleCredit {
  id: string;
  /** In the language matchTrack uses for the song: Japanese for Japanese songs, else English. */
  name: string;
  /** Every name Apple gives the artist in the languages read ("Wu Bai", "ウーバイ"). */
  names: string[];
  artwork: AppleArtwork | null;
}

export interface AppleSongCredits {
  /** The song is sung in Japanese; an instrumental follows its album. */
  japanese: boolean;
  albumId: string | null;
  artists: AppleCredit[];
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
    albums?: { data?: Array<{ id?: string }> };
  };
}

interface CatalogArtist {
  id: string;
  name: string;
  artwork: AppleArtwork | null;
}

interface AppleArtist {
  id: string;
  attributes?: {
    editorialArtwork?: Record<string, AppleArtwork | undefined>;
    editorialVideo?: Record<string, { video?: string; previewFrame?: AppleArtwork } | undefined>;
  };
}

/** Apple's motion artwork for an artist: a silent loop of about half a minute. */
export interface AppleMotionVideo {
  /** HLS master playlist on Apple's CDN. */
  url: string;
  /** A still of the video, also 16:9. */
  preview: AppleArtwork;
}

/** What Apple shows at the top of an artist's page, beyond their photo. */
export interface AppleArtistPage {
  logo: AppleArtwork | null;
  video: AppleMotionVideo | null;
  /** A 4:1 header image without text, 4320 px wide, for pages without a video. */
  banner: AppleArtwork | null;
}

interface CatalogItem {
  audioLocale: string;
  albumId: string | null;
  artists: CatalogArtist[];
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

export function localizedValue(original: string, localized: string, japanese: boolean): string | null {
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
  private albumLocales = new Map<string, Promise<string | null>>();

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

  /**
   * Most common sung locale on an album. Instrumentals are tagged "zxx" (no
   * linguistic content), which says nothing about the release they belong to.
   */
  private albumAudioLocale(storefront: string, albumId: string): Promise<string | null> {
    const key = `${storefront}/${albumId}`;
    let locale = this.albumLocales.get(key);
    if (!locale) {
      locale = this.get(`catalog/${storefront}/albums/${albumId}/tracks`, {}).then((payload) => {
        const counts = new Map<string, number>();
        for (const track of (payload.data as unknown as AppleSong[] | undefined) ?? []) {
          const value = track.attributes?.audioLocale?.trim().toLowerCase();
          if (value && value !== 'zxx') counts.set(value, (counts.get(value) ?? 0) + 1);
        }
        return [...counts].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
      });
      // A failed lookup must not stick for the rest of the run.
      locale.catch(() => this.albumLocales.delete(key));
      this.albumLocales.set(key, locale);
    }
    return locale;
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
      'include[songs]': 'artists,albums',
    });
    const candidates = payload.results?.songs?.data ?? [];
    const ranked = candidates
      .map((song, rank) => ({ song, score: scoreSong(input, song, rank) }))
      .sort((a, b) => b.score - a.score);
    const best = ranked[0];
    if (!best || best.score < 45) return null;

    let song = best.song;
    let locale = (song.attributes?.audioLocale ?? '').toLowerCase();
    const albumId = song.relationships?.albums?.data?.[0]?.id;
    // An instrumental follows its album, so it carries the same credits as the
    // vocal version ("りりあ。", not "Riria.") and lands on the same artist.
    if (locale === 'zxx' && albumId) locale = await this.albumAudioLocale(storefront, albumId) ?? locale;
    const japanese = locale.startsWith('ja');
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

  /**
   * The artists each song credits, in credit order. Unlike artistName ("Shawn
   * Mendes & Camila Cabello"), relationships.artists gives each of them an ID of
   * their own, yet keeps an act Apple lists as one ("Wu Bai & China Blue")
   * whole. feat. guests are in neither and appear only in the title. Names are
   * read in both catalog languages so a tag spelled either way can be matched.
   * A song Apple re-issued under a new ID is found by its ISRC; songs the
   * storefront does not carry at all are left out.
   */
  async songCredits(songs: Array<{ songId: string; isrc: string | null }>): Promise<Map<string, AppleSongCredits>> {
    const native = await this.catalogCredits('songs', songs.map((song) => song.songId), this.language);
    const missing = songs.filter((song) => !native.has(song.songId) && song.isrc);
    const byIsrc = await this.songIdsByIsrc(this.storefront, missing.map((song) => song.isrc!));
    const reissued = new Map(missing.flatMap((song) => {
      const id = byIsrc.get(song.isrc!.toUpperCase());
      return id ? [[song.songId, id] as const] : [];
    }));
    for (const [id, song] of await this.catalogCredits('songs', [...reissued.values()], this.language)) native.set(id, song);
    const current = (songId: string) => reissued.get(songId) ?? songId;
    const english = this.language === 'en-US'
      ? native
      : await this.catalogCredits('songs', songs.map((song) => current(song.songId)), 'en-US');

    const credits = new Map<string, AppleSongCredits>();
    for (const { songId } of songs) {
      const id = current(songId);
      const song = native.get(id);
      if (!song) continue;
      let locale = song.audioLocale;
      if (locale === 'zxx' && song.albumId) locale = await this.albumAudioLocale(this.storefront, song.albumId) ?? locale;
      const japanese = locale.startsWith('ja');
      credits.set(songId, { japanese, albumId: song.albumId, artists: this.mergeCredits(song.artists, english.get(id)?.artists, japanese) });
    }
    return credits;
  }

  /**
   * The artists each album credits. An album can credit fewer than its songs:
   * Handwritten credits only Shawn Mendes, though one of its songs is a duet.
   */
  async albumCredits(albumIds: string[], japaneseAlbums: Set<string>): Promise<Map<string, AppleCredit[]>> {
    const native = await this.catalogCredits('albums', albumIds, this.language);
    const english = this.language === 'en-US' ? native : await this.catalogCredits('albums', albumIds, 'en-US');
    return new Map([...native].map(([id, album]) => [
      id,
      this.mergeCredits(album.artists, english.get(id)?.artists, japaneseAlbums.has(id)),
    ]));
  }

  /**
   * The logo and motion artwork Apple shows at the top of each artist's page.
   * The logo is their name in their own lettering, trimmed to its edges on a
   * transparent background; the color version is preferred over the white
   * one. brandLogo is not a logo for every artist (for some it is a square
   * portrait), so it is never used. The video is the 16:9 one Apple plays
   * behind the logo, and the banner (bannerUber) the still header it shows
   * otherwise. About a quarter of artists have each.
   */
  async artistPages(ids: string[]): Promise<Map<string, AppleArtistPage>> {
    const pages = new Map<string, AppleArtistPage>();
    const unique = [...new Set(ids)];
    // The artists resource takes at most 50 IDs per request.
    for (let i = 0; i < unique.length; i += 50) {
      const batch = unique.slice(i, i + 50);
      const payload = await this.get(`catalog/${this.storefront}/artists`, {
        ids: batch.join(','),
        extend: 'editorialArtwork,editorialVideo',
      });
      const found = new Map(((payload.data as unknown as AppleArtist[] | undefined) ?? []).map((artist) => [artist.id, artist]));
      for (const id of batch) {
        const { editorialArtwork: artwork, editorialVideo: videos } = found.get(id)?.attributes ?? {};
        const logo = artwork?.musicContentColorLogoTrimmed ?? artwork?.musicContentWhiteLogoTrimmed;
        const video = videos?.motionArtistFullscreen16x9 ?? videos?.motionArtistWide16x9;
        pages.set(id, {
          logo: logo?.url ? logo : null,
          video: video?.video && video.previewFrame?.url ? { url: video.video, preview: video.previewFrame } : null,
          banner: artwork?.bannerUber?.url ? artwork.bannerUber : null,
        });
      }
    }
    return pages;
  }

  /** Pair each artist's catalog-language name with the English one, choosing between them as matchTrackAt does. */
  private mergeCredits(native: CatalogArtist[], english: CatalogArtist[] | undefined, japanese: boolean): AppleCredit[] {
    const englishById = new Map(english?.map((artist) => [artist.id, artist]) ?? []);
    const preferEnglish = !japanese && this.language.toLowerCase().startsWith('ja');
    return native.map((artist) => {
      const other = englishById.get(artist.id);
      return {
        id: artist.id,
        name: (preferEnglish ? other?.name : undefined) || artist.name,
        names: [...new Set([artist.name, other?.name].filter((name): name is string => !!name))],
        artwork: artist.artwork ?? other?.artwork ?? null,
      };
    });
  }

  private async catalogCredits(type: 'songs' | 'albums', ids: string[], language: string): Promise<Map<string, CatalogItem>> {
    const items = new Map<string, CatalogItem>();
    const unique = [...new Set(ids)];
    for (let i = 0; i < unique.length; i += 100) {
      const payload = await this.get(`catalog/${this.storefront}/${type}`, {
        ids: unique.slice(i, i + 100).join(','),
        include: type === 'songs' ? 'artists,albums' : 'artists',
        l: language,
      });
      // Albums carry the same attributes and artist relationship as songs.
      for (const item of (payload.data as unknown as AppleSong[] | undefined) ?? []) {
        items.set(item.id, {
          audioLocale: (item.attributes?.audioLocale ?? '').toLowerCase(),
          albumId: item.relationships?.albums?.data?.[0]?.id ?? null,
          artists: (item.relationships?.artists?.data ?? []).flatMap((artist) => {
            const id = artist.id?.trim();
            const name = artist.attributes?.name?.trim();
            return id && name ? [{ id, name, artwork: artist.attributes?.artwork?.url ? artist.attributes.artwork : null }] : [];
          }),
        });
      }
    }
    return items;
  }

  /**
   * Primary genre of each song, from the public iTunes lookup. The catalog
   * API's genre relationship only reaches top-level genres, so "Mandopop" came
   * back as "Pop". Both names come from the Taiwan catalog and so name the same
   * genre. Catalog IDs can differ between storefronts, so a song Taiwan does not
   * know by the match's ID is found there by ISRC. A song Taiwan lacks gets only
   * an English name, from the match's storefront. Songs neither carries map to null.
   */
  async songGenres(songs: Array<{ songId: string; isrc: string | null }>): Promise<Map<string, AppleGenre | null>> {
    const zh = await this.lookupGenres(songs.map((song) => song.songId), GENRE_STOREFRONT);
    const taiwanIds = new Map(songs.filter((song) => zh.has(song.songId)).map((song) => [song.songId, song.songId]));
    const byIsrc = await this.songIdsByIsrc(
      GENRE_STOREFRONT,
      songs.flatMap((song) => !taiwanIds.has(song.songId) && song.isrc ? [song.isrc] : []),
    );
    for (const song of songs) {
      const taiwanId = !taiwanIds.has(song.songId) && song.isrc ? byIsrc.get(song.isrc.toUpperCase()) : undefined;
      if (taiwanId) taiwanIds.set(song.songId, taiwanId);
    }
    for (const [id, name] of await this.lookupGenres([...byIsrc.values()], GENRE_STOREFRONT)) zh.set(id, name);
    const en = await this.lookupGenres([...new Set(taiwanIds.values())], GENRE_STOREFRONT, 'en_us');

    const elsewhere = songs.filter((song) => !en.has(taiwanIds.get(song.songId) ?? '')).map((song) => song.songId);
    const fallback = elsewhere.length && this.storefront !== GENRE_STOREFRONT
      ? await this.lookupGenres(elsewhere, this.storefront, 'en_us')
      : new Map<string, string>();
    return new Map(songs.map((song) => {
      const taiwanId = taiwanIds.get(song.songId) ?? '';
      const name = en.get(taiwanId);
      if (name) return [song.songId, { zh: zh.get(taiwanId) ?? null, en: name }];
      const english = fallback.get(song.songId);
      return [song.songId, english ? { zh: null, en: english } : null];
    }));
  }

  /** One song ID per ISRC in the storefront; a single and its album often share one ISRC. */
  private async songIdsByIsrc(storefront: string, isrcs: string[]): Promise<Map<string, string>> {
    const ids = new Map<string, string>();
    const unique = [...new Set(isrcs.map((isrc) => isrc.toUpperCase()))];
    for (let i = 0; i < unique.length; i += 25) {
      const payload = await this.get(`catalog/${storefront}/songs`, { 'filter[isrc]': unique.slice(i, i + 25).join(',') });
      for (const song of (payload.data as unknown as AppleSong[] | undefined) ?? []) {
        const isrc = song.attributes?.isrc?.toUpperCase();
        if (isrc && !ids.has(isrc)) ids.set(isrc, song.id);
      }
    }
    return ids;
  }

  /** primaryGenreName of each song the storefront carries; lang=en_us names it in English. */
  private async lookupGenres(songIds: string[], country: string, lang?: 'en_us'): Promise<Map<string, string>> {
    const names = new Map<string, string>();
    for (let i = 0; i < songIds.length; i += 150) {
      const url = new URL(ITUNES_LOOKUP);
      url.searchParams.set('id', songIds.slice(i, i + 150).join(','));
      url.searchParams.set('country', country);
      if (lang) url.searchParams.set('lang', lang);
      for (const result of (await this.lookup(url)).results ?? []) {
        const name = result.primaryGenreName?.trim();
        if (result.trackId && name) names.set(String(result.trackId), name);
      }
    }
    return names;
  }

  /** The lookup allows about 20 requests a minute and answers 403 past that. */
  private async lookup(url: URL): Promise<ITunesLookup> {
    let status = 0;
    for (let attempt = 0; attempt < 5; attempt++) {
      const response = await fetch(url);
      if (response.ok) return await response.json() as ITunesLookup;
      status = response.status;
      if (status !== 403 && status !== 429 && status < 500) break;
      await delay(5000 * 2 ** attempt);
    }
    throw new Error(`iTunes 查詢失敗：HTTP ${status}`);
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

/**
 * The artwork as a WebP that fits a `size` px square, in its own proportions.
 * The size is spelled out in the URL because some templates crop to the
 * requested shape ("sr", as on 4:1 banners) instead of fitting inside it
 * ("bb"); neither is asked for more than the original.
 */
export function appleArtworkUrl(artwork: AppleArtwork, size: number): string {
  const { width, height } = artwork;
  const scale = width > 0 && height > 0 ? Math.min(1, size / Math.max(width, height)) : 0;
  return artwork.url
    .replace(/\{w\}/g, String(scale ? Math.round(width * scale) : size))
    .replace(/\{h\}/g, String(scale ? Math.round(height * scale) : size))
    .replace(/\{f\}/g, 'webp')
    .replace(/\.(?:jpg|jpeg|png)(?=\?|$)/i, '.webp');
}
