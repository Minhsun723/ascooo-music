package com.ascooo.android.music.playback

import android.app.PendingIntent
import android.content.Intent
import androidx.annotation.OptIn
import androidx.media3.common.AudioAttributes
import androidx.media3.common.C
import androidx.media3.common.MediaItem
import androidx.media3.common.PlaybackException
import androidx.media3.common.Player
import androidx.media3.common.Tracks
import androidx.media3.common.util.UnstableApi
import androidx.media3.datasource.okhttp.OkHttpDataSource
import androidx.media3.exoplayer.ExoPlayer
import androidx.media3.exoplayer.source.DefaultMediaSourceFactory
import androidx.media3.exoplayer.util.EventLogger
import androidx.media3.session.MediaSession
import androidx.media3.session.MediaSessionService
import com.ascooo.android.music.BuildConfig
import com.ascooo.android.music.MainActivity
import com.ascooo.android.music.appContainer
import com.ascooo.android.music.data.HistoryRequest
import com.google.common.util.concurrent.Futures
import com.google.common.util.concurrent.ListenableFuture
import kotlinx.coroutines.MainScope
import kotlinx.coroutines.cancel
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch

/**
 * Owns the player so music keeps going with the app in the background, and publishes the media
 * notification, lock screen and Bluetooth controls through its MediaSession.
 */
@OptIn(UnstableApi::class) // OkHttpDataSource and DefaultMediaSourceFactory's DataSource constructor
class PlaybackService : MediaSessionService() {
  private var session: MediaSession? = null
  private val scope = MainScope()

  override fun onCreate() {
    super.onCreate()
    val container = appContainer
    // Streams go through the shared client, so they carry the session token like any API call.
    val player =
      ExoPlayer.Builder(this)
        .setMediaSourceFactory(DefaultMediaSourceFactory(OkHttpDataSource.Factory(container.httpClient)))
        .setAudioAttributes(
          AudioAttributes.Builder().setUsage(C.USAGE_MEDIA).setContentType(C.AUDIO_CONTENT_TYPE_MUSIC).build(),
          /* handleAudioFocus= */ true,
        )
        .setHandleAudioBecomingNoisy(true)
        .setWakeMode(C.WAKE_MODE_NETWORK)
        .build()
    player.addListener(AudioFallback(player))
    // Debug builds log the chosen decoder and audio format under the EventLogger tag.
    if (BuildConfig.DEBUG) player.addAnalyticsListener(EventLogger())

    session =
      MediaSession.Builder(this, player)
        .setSessionActivity(
          PendingIntent.getActivity(
            this,
            0,
            Intent(this, MainActivity::class.java),
            PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT,
          )
        )
        .setCallback(
          object : MediaSession.Callback {
            override fun onAddMediaItems(
              mediaSession: MediaSession,
              controller: MediaSession.ControllerInfo,
              mediaItems: MutableList<MediaItem>,
            ): ListenableFuture<MutableList<MediaItem>> =
              Futures.immediateFuture(
                mediaItems.map { it.buildUpon().setUri(it.requestMetadata.mediaUri).build() }.toMutableList()
              )
          }
        )
        .build()

    scope.launch { reportPlays(player) }
  }

  override fun onGetSession(controllerInfo: MediaSession.ControllerInfo): MediaSession? = session

  override fun onDestroy() {
    scope.cancel()
    session?.run {
      player.release()
      release()
    }
    session = null
    super.onDestroy()
  }

  /** Same rule as the website: a track counts as played once it passes 30 s, or half of a shorter track. */
  private suspend fun reportPlays(player: Player) {
    var reportedFor: String? = null
    player.addListener(
      object : Player.Listener {
        override fun onMediaItemTransition(mediaItem: MediaItem?, reason: Int) {
          if (reason != Player.MEDIA_ITEM_TRANSITION_REASON_REPEAT) reportedFor = null
        }
      }
    )
    while (true) {
      delay(5_000)
      val id = player.currentMediaItem?.mediaId ?: continue
      if (!player.isPlaying || id == reportedFor) continue
      val seconds = player.duration.takeIf { it > 0 }?.div(1000.0) ?: 60.0
      if (player.currentPosition / 1000.0 > minOf(30.0, seconds / 2)) {
        reportedFor = id
        runCatching { appContainer.api.history(HistoryRequest(id.toLong())) }
      }
    }
  }
}

/**
 * Keeps a track the phone cannot decode from failing silently. Like the website, a Dolby Atmos
 * track moves to its AAC 5.1 copy and carries on from the same spot; anything else pauses, and
 * [PlayerViewModel][com.ascooo.android.music.ui.player.PlayerViewModel] shows why.
 */
private class AudioFallback(private val player: ExoPlayer) : Player.Listener {
  // A decoder that is listed but then fails on the file.
  override fun onPlayerError(error: PlaybackException) {
    if (error.errorCode in DECODING_ERRORS) switchToAac51()
  }

  // No decoder at all: ExoPlayer leaves the audio track out and would play on in silence.
  override fun onTracksChanged(tracks: Tracks) {
    if (tracks.audioUnplayable && !switchToAac51()) player.pause()
  }

  private fun switchToAac51(): Boolean {
    val index = player.currentMediaItemIndex
    val item = player.currentMediaItem ?: return false
    val uri = item.localConfiguration?.uri ?: return false
    if (item.mediaMetadata.extras?.getBoolean(EXTRA_HAS_AAC51) != true || uri.getQueryParameter("v") == "aac51") return false

    val position = player.currentPosition
    val aac51 = uri.buildUpon().appendQueryParameter("v", "aac51").build()
    player.replaceMediaItem(index, item.buildUpon().setUri(aac51).build())
    player.seekTo(index, position)
    player.prepare()
    player.play()
    return true
  }

  private companion object {
    val DECODING_ERRORS =
      PlaybackException.ERROR_CODE_DECODER_INIT_FAILED..PlaybackException.ERROR_CODE_DECODING_FORMAT_UNSUPPORTED
  }
}
