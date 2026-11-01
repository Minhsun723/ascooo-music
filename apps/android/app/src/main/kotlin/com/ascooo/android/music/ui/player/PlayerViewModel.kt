package com.ascooo.android.music.ui.player

import android.app.Application
import android.content.ComponentName
import android.net.Uri
import androidx.lifecycle.AndroidViewModel
import androidx.lifecycle.viewModelScope
import androidx.media3.common.C
import androidx.media3.common.PlaybackException
import androidx.media3.common.Player
import androidx.media3.common.util.Util
import androidx.media3.session.MediaController
import androidx.media3.session.SessionToken
import com.ascooo.android.music.appContainer
import com.ascooo.android.music.data.Track
import com.ascooo.android.music.playback.PlaybackService
import com.ascooo.android.music.playback.audioUnplayable
import com.ascooo.android.music.playback.toMediaItem
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.guava.await
import kotlinx.coroutines.launch

data class NowPlaying(val mediaId: String, val title: String, val artist: String, val album: String, val artworkUri: Uri?)

data class PlayerUiState(
  val nowPlaying: NowPlaying? = null,
  val isPlaying: Boolean = false,
  val isBuffering: Boolean = false,
  val durationMs: Long = 0,
  val error: String? = null,
)

/** The UI's handle on [PlaybackService]'s player, through a MediaController. One per activity. */
class PlayerViewModel(application: Application) : AndroidViewModel(application) {
  private val baseUrl = application.appContainer.baseUrl
  private val controller = CompletableDeferred<MediaController>()
  private var connected: MediaController? = null
  private val _state = MutableStateFlow(PlayerUiState())
  val state: StateFlow<PlayerUiState> = _state.asStateFlow()

  private val listener =
    object : Player.Listener {
      override fun onEvents(player: Player, events: Player.Events) = refresh(player)
    }

  init {
    viewModelScope.launch {
      val token = SessionToken(application, ComponentName(application, PlaybackService::class.java))
      val built = MediaController.Builder(application, token).buildAsync().await()
      built.addListener(listener)
      refresh(built)
      connected = built
      controller.complete(built)
    }
  }

  /** Read on demand by the progress bars rather than pushed, so idle screens cost nothing. */
  fun positionMs(): Long = connected?.currentPosition ?: 0

  fun play(tracks: List<Track>, startIndex: Int = 0) = withController {
    it.setMediaItems(tracks.map { track -> track.toMediaItem(baseUrl) }, startIndex, 0)
    it.prepare()
    it.play()
  }

  fun togglePlayPause() = withController { Util.handlePlayPauseButtonAction(it) }

  fun next() = withController { it.seekToNext() }

  fun previous() = withController { it.seekToPrevious() }

  fun seekTo(positionMs: Long) = withController { it.seekTo(positionMs) }

  /** After signing out nothing may keep streaming with the old session. */
  fun stop() = withController {
    it.stop()
    it.clearMediaItems()
  }

  private fun withController(action: (MediaController) -> Unit) {
    viewModelScope.launch { action(controller.await()) }
  }

  private fun refresh(player: Player) {
    val meta = player.mediaMetadata
    _state.value =
      PlayerUiState(
        nowPlaying =
          player.currentMediaItem?.let {
            NowPlaying(
              mediaId = it.mediaId,
              title = meta.title?.toString().orEmpty(),
              artist = meta.artist?.toString().orEmpty(),
              album = meta.albumTitle?.toString().orEmpty(),
              artworkUri = meta.artworkUri,
            )
          },
        isPlaying = player.isPlaying,
        isBuffering = player.playbackState == Player.STATE_BUFFERING,
        durationMs = player.duration.takeIf { it != C.TIME_UNSET } ?: meta.durationMs ?: 0,
        error = player.playerError?.let(::describe) ?: UNPLAYABLE.takeIf { player.currentTracks.audioUnplayable },
      )
  }

  private fun describe(error: PlaybackException): String =
    when (error.errorCode) {
      in PlaybackException.ERROR_CODE_DECODER_INIT_FAILED..PlaybackException.ERROR_CODE_DECODING_FORMAT_UNSUPPORTED -> UNPLAYABLE
      else -> "暫時無法載入音訊，請稍後再試"
    }

  private companion object {
    const val UNPLAYABLE = "這台裝置無法播放這個格式"
  }

  override fun onCleared() {
    connected?.run {
      removeListener(listener)
      release()
    }
    connected = null
  }
}
