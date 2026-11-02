package com.ascooo.android.music.data

import android.content.Context
import androidx.datastore.preferences.core.edit
import androidx.datastore.preferences.core.longPreferencesKey
import androidx.datastore.preferences.core.stringPreferencesKey
import androidx.datastore.preferences.preferencesDataStore
import kotlin.random.Random
import kotlinx.coroutines.flow.first
import kotlinx.serialization.json.Json

private val Context.homeDataStore by preferencesDataStore(name = "home")
private val HOME = stringPreferencesKey("home")
private val FETCHED_AT = longPreferencesKey("fetched_at")
private val SEED = longPreferencesKey("seed")
private val SEED_ISSUED_AT = longPreferencesKey("seed_issued_at")

/** As long as the server keeps the shelves one seed draws; within it a saved copy stands in for a request. */
private const val FRESH_MS = 10 * 60_000L
/** Same as the website: the random shelves keep their picks for an hour, across restarts too. */
private const val SEED_MS = 60 * 60_000L

/**
 * The last home page, kept on the device so the app opens straight onto it, and the seed its random
 * shelves are drawn from. A copy younger than [FRESH_MS] is shown without asking the server, unless
 * a play or a heart has since changed what it shows.
 */
class HomeCache(context: Context, private val json: Json) {
  private val store = context.homeDataStore

  class Saved(val home: HomeData, val fresh: Boolean)

  suspend fun read(): Saved? {
    val prefs = store.data.first()
    val home = prefs[HOME]?.let { runCatching { json.decodeFromString<HomeData>(it) }.getOrNull() } ?: return null
    val age = System.currentTimeMillis() - (prefs[FETCHED_AT] ?: 0)
    return Saved(home, age in 0 until FRESH_MS)
  }

  suspend fun write(home: HomeData) {
    store.edit {
      it[HOME] = json.encodeToString(home)
      it[FETCHED_AT] = System.currentTimeMillis()
    }
  }

  /** The copy still shows, but the next start fetches the page again. */
  suspend fun markStale() {
    store.edit { it.remove(FETCHED_AT) }
  }

  /** Another account's plays and hearts mean nothing to the next one. */
  suspend fun clear() {
    store.edit { it.clear() }
  }

  suspend fun seed(): Long {
    val now = System.currentTimeMillis()
    var seed = 0L
    store.edit {
      val current = it[SEED]
      if (current != null && now - (it[SEED_ISSUED_AT] ?: 0) in 0 until SEED_MS) {
        seed = current
      } else {
        seed = Random.nextLong(1L shl 32)
        it[SEED] = seed
        it[SEED_ISSUED_AT] = now
      }
    }
    return seed
  }
}
