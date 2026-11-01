package com.ascooo.android.music

import android.app.Application
import android.content.Context
import coil3.ImageLoader
import coil3.PlatformContext
import coil3.SingletonImageLoader
import coil3.network.okhttp.OkHttpNetworkFetcherFactory
import coil3.request.crossfade

class AscoooApplication : Application(), SingletonImageLoader.Factory {
  lateinit var container: AppContainer
    private set

  override fun onCreate() {
    super.onCreate()
    container = AppContainer(this)
  }

  // Covers share the API client, so they reuse its connections to the same host.
  override fun newImageLoader(context: PlatformContext): ImageLoader =
    ImageLoader.Builder(context)
      .components { add(OkHttpNetworkFetcherFactory(callFactory = { container.httpClient })) }
      .crossfade(true)
      .build()
}

val Context.appContainer: AppContainer
  get() = (applicationContext as AscoooApplication).container
