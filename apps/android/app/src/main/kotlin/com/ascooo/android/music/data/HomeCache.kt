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
private val SEED = longPreferencesKey("seed")
private val SEED_ISSUED_AT = longPreferencesKey("seed_issued_at")

/** Same as the website: the random shelves keep their picks for an hour, across restarts too. */
private const val SEED_MS = 60 * 60_000L

/**
 * The last home page, kept on the device so the app opens straight onto it while a fresh copy is
 * fetched behind it, and the seed its random shelves are drawn from.
 */
class HomeCache(context: Context, private val json: Json) {
  private val store = context.homeDataStore

  suspend fun read(): HomeData? =
    store.data.first()[HOME]?.let { runCatching { json.decodeFromString<HomeData>(it) }.getOrNull() }

  suspend fun write(home: HomeData) {
    store.edit { it[HOME] = json.encodeToString(home) }
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
