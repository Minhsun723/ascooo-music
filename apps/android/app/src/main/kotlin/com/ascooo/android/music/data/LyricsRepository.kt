package com.ascooo.android.music.data

import android.util.LruCache

/** Lyrics by track, kept for the last few songs so going back to one, or reopening it, doesn't ask again. */
class LyricsRepository(private val api: AscoooApi) {
  /** A song without lyrics is remembered too, as an entry holding null. */
  class Entry(val lyrics: Lyrics?)

  private val cache = LruCache<Long, Entry>(16)

  fun cached(trackId: Long): Entry? = cache.get(trackId)

  /** Throws like any API call, for the screen to show. */
  suspend fun get(trackId: Long): Lyrics? {
    cache.get(trackId)?.let { return it.lyrics }
    val lyrics = api.lyrics(trackId).lyrics
    cache.put(trackId, Entry(lyrics))
    return lyrics
  }
}
