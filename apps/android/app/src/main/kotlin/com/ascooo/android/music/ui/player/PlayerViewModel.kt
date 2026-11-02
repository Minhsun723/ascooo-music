package com.ascooo.android.music.ui.player

import android.app.Application
import android.content.ComponentName
import android.net.Uri
import androidx.lifecycle.AndroidViewModel
import androidx.lifecycle.viewModelScope
import androidx.media3.common.C
import androidx.media3.common.PlaybackException
import androidx.media3.common.Player
import androidx.media3.common.Timeline
import androidx.media3.common.util.Util
import androidx.media3.session.MediaController
import androidx.media3.session.SessionToken
import com.ascooo.android.music.appContainer
import com.ascooo.android.music.data.Track
import com.ascooo.android.music.playback.EXTRA_LIKED
import com.ascooo.android.music.playback.EXTRA_THUMBNAIL
import com.ascooo.android.music.playback.PlaybackService
import com.ascooo.android.music.playback.audioUnplayable
import com.ascooo.android.music.playback.toMediaItem
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.guava.await
import kotlinx.coroutines.launch

data class NowPlaying(
  val mediaId: String,
  val title: String,
  val artist: String,
  val album: String,
  val artworkUri: Uri?,
  /** As queued; LikesRepository has any change since. */
  val liked: Boolean,
)

/** A queued track. [index] is its place in the player's list, which shuffle doesn't change. */
data class QueueEntry(val index: Int, val mediaId: String, val title: String, val artist: String, val thumbnail: String?)

data class PlayerUiState(
  val nowPlaying: NowPlaying? = null,
  val isPlaying: Boolean = false,
  // What the play/pause button offers. It follows what was asked for rather than what is audible,
  // so a track that is still buffering already shows pause.
  val showPlayButton: Boolean = true,
  // Where playback stood at the last player event (a seek, a pause, a new track).
  val positionMs: Long = 0,
  val isBuffering: Boolean = false,
  val durationMs: Long = 0,
  val error: String? = null,
  val shuffle: Boolean = false,
  val repeatMode: Int = Player.REPEAT_MODE_OFF,
  /** In the order it will play, so a shuffled queue reads as it sounds. */
  val queue: List<QueueEntry> = emptyList(),
  val currentIndex: Int = C.INDEX_UNSET,
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

  fun play(tracks: List<Track>, startIndex: Int = 0) = withController { start(it, tracks, startIndex) }

  /** Right after the current track; with nothing queued, they just play. */
  fun playNext(tracks: List<Track>) = withController {
    if (it.mediaItemCount == 0) start(it, tracks) else it.addMediaItems(it.currentMediaItemIndex + 1, tracks.map { track -> track.toMediaItem(baseUrl) })
  }

  /** At the end of the queue; with nothing queued, they just play. */
  fun addToQueue(tracks: List<Track>) = withController {
    if (it.mediaItemCount == 0) start(it, tracks) else it.addMediaItems(tracks.map { track -> track.toMediaItem(baseUrl) })
  }

  private fun start(controller: MediaController, tracks: List<Track>, startIndex: Int = 0) {
    controller.setMediaItems(tracks.map { track -> track.toMediaItem(baseUrl) }, startIndex, 0)
    controller.prepare()
    controller.play()
  }

  fun togglePlayPause() = withController { Util.handlePlayPauseButtonAction(it) }

  fun next() = withController { it.seekToNext() }

  fun previous() = withController { it.seekToPrevious() }

  fun seekTo(positionMs: Long) = withController { it.seekTo(positionMs) }

  fun toggleShuffle() = withController { it.shuffleModeEnabled = !it.shuffleModeEnabled }

  /** Off, then the whole queue, then the one track, as on the website. */
  fun cycleRepeat() = withController {
    it.repeatMode =
      when (it.repeatMode) {
        Player.REPEAT_MODE_OFF -> Player.REPEAT_MODE_ALL
        Player.REPEAT_MODE_ALL -> Player.REPEAT_MODE_ONE
        else -> Player.REPEAT_MODE_OFF
      }
  }

  /** Plays the queued track at [index] (a [QueueEntry.index]) from its start. */
  fun jumpTo(index: Int) = withController {
    it.seekToDefaultPosition(index)
    it.play()
  }

  fun removeFromQueue(index: Int) = withController { it.removeMediaItem(index) }

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
              liked = meta.extras?.getBoolean(EXTRA_LIKED) ?: false,
            )
          },
        isPlaying = player.isPlaying,
        showPlayButton = Util.shouldShowPlayButton(player),
        positionMs = player.currentPosition,
        isBuffering = player.playbackState == Player.STATE_BUFFERING,
        durationMs = player.duration.takeIf { it != C.TIME_UNSET } ?: meta.durationMs ?: 0,
        error = player.playerError?.let(::describe) ?: UNPLAYABLE.takeIf { player.currentTracks.audioUnplayable },
        shuffle = player.shuffleModeEnabled,
        repeatMode = player.repeatMode,
        queue = queueOf(player),
        currentIndex = player.currentMediaItemIndex,
      )
  }

  private val window = Timeline.Window()

  private fun queueOf(player: Player): List<QueueEntry> {
    val timeline = player.currentTimeline
    val shuffle = player.shuffleModeEnabled
    return buildList {
      var index = timeline.getFirstWindowIndex(shuffle)
      while (index != C.INDEX_UNSET) {
        val item = timeline.getWindow(index, window).mediaItem
        val meta = item.mediaMetadata
        add(
          QueueEntry(
            index = index,
            mediaId = item.mediaId,
            title = meta.title?.toString().orEmpty(),
            artist = meta.artist?.toString().orEmpty(),
            thumbnail = meta.extras?.getString(EXTRA_THUMBNAIL),
          )
        )
        index = timeline.getNextWindowIndex(index, Player.REPEAT_MODE_OFF, shuffle)
      }
    }
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
