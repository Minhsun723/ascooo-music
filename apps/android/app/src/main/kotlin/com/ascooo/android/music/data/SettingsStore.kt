package com.ascooo.android.music.data

import android.content.Context
import androidx.datastore.preferences.core.booleanPreferencesKey
import androidx.datastore.preferences.core.edit
import androidx.datastore.preferences.core.stringPreferencesKey
import androidx.datastore.preferences.preferencesDataStore
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.map

private val Context.settingsDataStore by preferencesDataStore(name = "settings")
private val DYNAMIC_COLOR = booleanPreferencesKey("dynamic_color")
private val LYRICS_FONT = stringPreferencesKey("lyrics_font")

/** The website's four lyrics typefaces. */
enum class LyricsFont {
  Sans,
  Serif,
  WenKai,
  Decol,
}

class SettingsStore(context: Context) {
  private val store = context.settingsDataStore

  /** Off: the website's near-black brand palette. On: Material You colours from the wallpaper. */
  val dynamicColor: Flow<Boolean> = store.data.map { it[DYNAMIC_COLOR] ?: false }

  suspend fun setDynamicColor(enabled: Boolean) {
    store.edit { it[DYNAMIC_COLOR] = enabled }
  }

  val lyricsFont: Flow<LyricsFont> =
    store.data.map { prefs -> LyricsFont.entries.firstOrNull { it.name == prefs[LYRICS_FONT] } ?: LyricsFont.Sans }

  suspend fun setLyricsFont(font: LyricsFont) {
    store.edit { it[LYRICS_FONT] = font.name }
  }
}
