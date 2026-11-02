package com.ascooo.android.music

import android.content.Context
import com.ascooo.android.music.data.AscoooApi
import com.ascooo.android.music.data.AuthInterceptor
import com.ascooo.android.music.data.AuthRepository
import com.ascooo.android.music.data.HomeCache
import com.ascooo.android.music.data.LikesRepository
import com.ascooo.android.music.data.LyricsRepository
import com.ascooo.android.music.data.PlaylistsRepository
import com.ascooo.android.music.data.SessionStore
import com.ascooo.android.music.data.SettingsStore
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.serialization.json.Json
import okhttp3.HttpUrl.Companion.toHttpUrl
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import retrofit2.Retrofit
import retrofit2.converter.kotlinx.serialization.asConverterFactory

/** The app's long-lived objects, created once per process by [AscoooApplication]. */
class AppContainer(context: Context) {
  val baseUrl: String = BuildConfig.API_BASE_URL.trimEnd('/')
  val scope = CoroutineScope(SupervisorJob() + Dispatchers.Default)

  val session = SessionStore(context, scope)
  val settings = SettingsStore(context)

  val httpClient: OkHttpClient =
    OkHttpClient.Builder().addInterceptor(AuthInterceptor(baseUrl.toHttpUrl().host, session)).build()

  val json = Json {
    ignoreUnknownKeys = true
    explicitNulls = false
    coerceInputValues = true
  }

  val api: AscoooApi =
    Retrofit.Builder()
      .baseUrl("$baseUrl/api/")
      .client(httpClient)
      .addConverterFactory(json.asConverterFactory("application/json".toMediaType()))
      .build()
      .create(AscoooApi::class.java)

  val homeCache = HomeCache(context, json)
  val auth = AuthRepository(api, session, homeCache)
  val notices = Notices()
  val likes = LikesRepository(api, scope, notices, homeCache)
  val playlists = PlaylistsRepository(api, scope, notices)
  val lyrics = LyricsRepository(api)
}
