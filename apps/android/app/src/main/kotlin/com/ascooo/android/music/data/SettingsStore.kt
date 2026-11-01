package com.ascooo.android.music.data

import android.content.Context
import androidx.datastore.preferences.core.booleanPreferencesKey
import androidx.datastore.preferences.core.edit
import androidx.datastore.preferences.preferencesDataStore
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.map

private val Context.settingsDataStore by preferencesDataStore(name = "settings")
private val DYNAMIC_COLOR = booleanPreferencesKey("dynamic_color")

class SettingsStore(context: Context) {
  private val store = context.settingsDataStore

  /** Off: the website's near-black brand palette. On: Material You colours from the wallpaper. */
  val dynamicColor: Flow<Boolean> = store.data.map { it[DYNAMIC_COLOR] ?: false }

  suspend fun setDynamicColor(enabled: Boolean) {
    store.edit { it[DYNAMIC_COLOR] = enabled }
  }
}
