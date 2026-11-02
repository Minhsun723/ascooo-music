package com.ascooo.android.music.ui.player

import androidx.compose.animation.core.Animatable
import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.foundation.background
import androidx.compose.foundation.gestures.Orientation
import androidx.compose.foundation.gestures.detectHorizontalDragGestures
import androidx.compose.foundation.gestures.detectTapGestures
import androidx.compose.foundation.gestures.draggable
import androidx.compose.foundation.gestures.rememberDraggableState
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.aspectRatio
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.offset
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.systemBarsPadding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.FilledIconToggleButton
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.IconButtonDefaults
import androidx.compose.material3.IconToggleButton
import androidx.compose.material3.LinearProgressIndicator
import androidx.compose.material3.LinearWavyProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.State
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableLongStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.produceState
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.rememberUpdatedState
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.layout.onSizeChanged
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.media3.common.Player
import com.ascooo.android.music.R
import com.ascooo.android.music.ui.components.Artwork
import com.ascooo.android.music.ui.components.LikeButton
import com.ascooo.android.music.ui.components.formatTime
import com.ascooo.android.music.ui.theme.CoverColors
import com.ascooo.android.music.ui.theme.animateCoverColors
import com.ascooo.android.music.ui.theme.cachedCoverColors
import com.ascooo.android.music.ui.theme.coverColors
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch

/**
 * The playhead. Every player event (a seek, a pause, a new track) re-reads it in the same frame, so a
 * seek while paused shows up; while playing it is also polled. ExoPlayer's position is already
 * smooth, so 5 Hz is plenty.
 */
@Composable
private fun rememberPosition(player: PlayerViewModel, state: PlayerUiState): State<Long> {
  val position = remember(state.positionMs, state.nowPlaying?.mediaId) { mutableLongStateOf(player.positionMs()) }
  LaunchedEffect(position, state.isPlaying) {
    while (state.isPlaying) {
      delay(200)
      position.longValue = player.positionMs()
    }
  }
  return position
}

@Composable
fun MiniPlayer(state: PlayerUiState, player: PlayerViewModel, onOpen: () -> Unit, modifier: Modifier = Modifier) {
  val now = state.nowPlaying ?: return
  val position by rememberPosition(player, state)
  Surface(
    onClick = onOpen,
    shape = MaterialTheme.shapes.largeIncreased,
    color = MaterialTheme.colorScheme.surfaceContainerHigh,
    modifier = modifier.fillMaxWidth().padding(horizontal = 8.dp, vertical = 6.dp),
  ) {
    Column {
      Row(Modifier.padding(start = 8.dp, end = 4.dp, top = 8.dp, bottom = 6.dp), verticalAlignment = Alignment.CenterVertically) {
        Artwork(now.artworkUri?.toString(), Modifier.size(44.dp), MaterialTheme.shapes.medium)
        Spacer(Modifier.width(12.dp))
        Column(Modifier.weight(1f)) {
          Text(now.title, style = MaterialTheme.typography.bodyLargeEmphasized, maxLines = 1, overflow = TextOverflow.Ellipsis)
          Text(
            state.error ?: now.artist,
            style = MaterialTheme.typography.bodyMedium,
            color = if (state.error != null) MaterialTheme.colorScheme.error else MaterialTheme.colorScheme.onSurfaceVariant,
            maxLines = 1,
            overflow = TextOverflow.Ellipsis,
          )
        }
        IconButton(onClick = player::togglePlayPause, shapes = IconButtonDefaults.shapes()) {
          Icon(
            painterResource(if (state.showPlayButton) R.drawable.ic_play else R.drawable.ic_pause),
            contentDescription = if (state.showPlayButton) "播放" else "暫停",
          )
        }
        IconButton(onClick = player::next, shapes = IconButtonDefaults.shapes()) {
          Icon(painterResource(R.drawable.ic_skip_next), contentDescription = "下一首")
        }
      }
      LinearProgressIndicator(
        progress = { if (state.durationMs > 0) (position.toFloat() / state.durationMs).coerceIn(0f, 1f) else 0f },
        modifier = Modifier.fillMaxWidth().padding(horizontal = 14.dp).padding(bottom = 8.dp),
      )
    }
  }
}

@Composable
fun NowPlayingScreen(state: PlayerUiState, player: PlayerViewModel, onCollapse: () -> Unit, modifier: Modifier = Modifier) {
  val now = state.nowPlaying ?: return
  val position by rememberPosition(player, state)
  var scrubbing by remember { mutableStateOf<Float?>(null) }
  var queueOpen by rememberSaveable { mutableStateOf(false) }
  val duration = state.durationMs.coerceAtLeast(1)
  val fraction = scrubbing ?: (position.toFloat() / duration).coerceIn(0f, 1f)

  // Pulled down, the page lifts off as a card over the app. A flick down or a drag past a quarter of
  // the screen closes it; anything less springs back.
  val drag = remember { Animatable(0f) }
  var height by remember { mutableIntStateOf(0) }
  val scope = rememberCoroutineScope()
  val density = LocalDensity.current
  val dismissVelocity = with(density) { DismissVelocity.toPx() }
  val maxCorner = with(density) { 28.dp.toPx() }
  val closeSpec = MaterialTheme.motionScheme.fastSpatialSpec<Float>()
  val settleSpec = MaterialTheme.motionScheme.defaultSpatialSpec<Float>()

  // Coloured after the cover. Until a cover's colours are worked out the previous ones stay, and a
  // cover with none keeps the app's palette on a plain backdrop.
  val context = LocalContext.current
  val artworkUrl = now.artworkUri?.toString()
  val appColors = CoverColors(MaterialTheme.colorScheme, MaterialTheme.colorScheme.surface)
  val cover by produceState(artworkUrl?.let(::cachedCoverColors), artworkUrl) { value = artworkUrl?.let { coverColors(context, it) } }
  val colors = animateCoverColors(cover ?: appColors)

  MaterialTheme(colorScheme = colors.scheme) {
    Surface(
      modifier
        .fillMaxSize()
        .onSizeChanged { height = it.height }
        // Ahead of the layer, so the finger is measured against the screen rather than the moving page.
        .draggable(
          state = rememberDraggableState { delta -> scope.launch { drag.snapTo((drag.value + delta).coerceAtLeast(0f)) } },
          orientation = Orientation.Vertical,
          startDragImmediately = drag.isRunning,
          onDragStopped = { velocity ->
            if (velocity > dismissVelocity || (velocity > -dismissVelocity && drag.value > height / 4f)) {
              drag.animateTo(height.toFloat(), closeSpec, velocity)
              onCollapse()
            } else {
              drag.animateTo(0f, settleSpec, velocity)
            }
          },
        )
        .graphicsLayer {
          // The spring back overshoots a hair past the top; the page and its corners stop there.
          val offset = drag.value.coerceAtLeast(0f)
          translationY = offset
          shape = RoundedCornerShape((offset / 4).coerceAtMost(maxCorner))
          clip = true
        },
      color = MaterialTheme.colorScheme.surface,
    ) {
      Column(
        Modifier.fillMaxSize()
          .background(Brush.verticalGradient(0f to colors.backdrop, 0.7f to MaterialTheme.colorScheme.surface))
          .systemBarsPadding()
          .padding(horizontal = 24.dp)
      ) {
        IconButton(
          onClick = onCollapse,
          shapes = IconButtonDefaults.shapes(),
          modifier = Modifier.padding(top = 8.dp).offset(x = (-12).dp),
        ) {
          Icon(painterResource(R.drawable.ic_collapse), contentDescription = "收合播放畫面")
        }
        Spacer(Modifier.weight(1f))
        // Full width where the screen is tall enough; on a short one the cover gives up the height the
        // controls need, staying square.
        Artwork(
          now.artworkUri?.toString(),
          Modifier.align(Alignment.CenterHorizontally).weight(12f, fill = false).fillMaxWidth().aspectRatio(1f),
          MaterialTheme.shapes.extraLargeIncreased,
        )
        Spacer(Modifier.height(32.dp))
        Row(verticalAlignment = Alignment.CenterVertically) {
          Column(Modifier.weight(1f)) {
            Text(now.title, style = MaterialTheme.typography.headlineSmallEmphasized, maxLines = 2, overflow = TextOverflow.Ellipsis)
            Text(
              now.artist,
              style = MaterialTheme.typography.titleMedium,
              color = MaterialTheme.colorScheme.onSurfaceVariant,
              maxLines = 1,
              overflow = TextOverflow.Ellipsis,
            )
          }
          now.mediaId.toLongOrNull()?.let { LikeButton(it, now.liked, Modifier.offset(x = 12.dp)) }
        }
        state.error?.let {
          Text(it, style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.error, modifier = Modifier.padding(top = 8.dp))
        }
        Spacer(Modifier.height(24.dp))
        SeekBar(
          fraction = fraction,
          playing = state.isPlaying,
          onScrub = { scrubbing = it },
          onSeek = {
            player.seekTo((it * duration).toLong())
            scrubbing = null
          },
        )
        Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
          Text(formatTime(fraction * duration / 1000.0), style = MaterialTheme.typography.labelMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
          Text(formatTime(duration / 1000.0), style = MaterialTheme.typography.labelMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
        }
        Spacer(Modifier.height(20.dp))
        Row(
          Modifier.fillMaxWidth(),
          horizontalArrangement = Arrangement.spacedBy(16.dp, Alignment.CenterHorizontally),
          verticalAlignment = Alignment.CenterVertically,
        ) {
          IconButton(
            onClick = player::previous,
            shapes = IconButtonDefaults.shapes(),
            modifier = Modifier.size(IconButtonDefaults.largeContainerSize()),
          ) {
            Icon(painterResource(R.drawable.ic_skip_previous), "上一首", Modifier.size(IconButtonDefaults.largeIconSize))
          }
          // Expressive toggle: round while paused, morphing to a rounded square while playing. Both states
          // keep the filled primary colour (white on the brand palette), so paused never reads as disabled.
          FilledIconToggleButton(
            checked = !state.showPlayButton,
            onCheckedChange = { player.togglePlayPause() },
            shapes = IconButtonDefaults.toggleableShapes(),
            colors =
              IconButtonDefaults.filledIconToggleButtonColors(
                containerColor = MaterialTheme.colorScheme.primary,
                contentColor = MaterialTheme.colorScheme.onPrimary,
                checkedContainerColor = MaterialTheme.colorScheme.primary,
                checkedContentColor = MaterialTheme.colorScheme.onPrimary,
              ),
            modifier = Modifier.size(IconButtonDefaults.extraLargeContainerSize()),
          ) {
            Icon(
              painterResource(if (state.showPlayButton) R.drawable.ic_play else R.drawable.ic_pause),
              contentDescription = if (state.showPlayButton) "播放" else "暫停",
              modifier = Modifier.size(IconButtonDefaults.extraLargeIconSize),
            )
          }
          IconButton(
            onClick = player::next,
            shapes = IconButtonDefaults.shapes(),
            modifier = Modifier.size(IconButtonDefaults.largeContainerSize()),
          ) {
            Icon(painterResource(R.drawable.ic_skip_next), "下一首", Modifier.size(IconButtonDefaults.largeIconSize))
          }
        }
        // How the queue plays on the left, the queue itself on the right.
        Row(Modifier.fillMaxWidth().padding(top = 12.dp), horizontalArrangement = Arrangement.SpaceBetween) {
          Row(Modifier.offset(x = (-12).dp)) {
            IconToggleButton(
              checked = state.shuffle,
              onCheckedChange = { player.toggleShuffle() },
              shapes = IconButtonDefaults.toggleableShapes(),
            ) {
              Icon(painterResource(R.drawable.ic_shuffle), contentDescription = if (state.shuffle) "關閉隨機播放" else "隨機播放")
            }
            IconToggleButton(
              checked = state.repeatMode != Player.REPEAT_MODE_OFF,
              onCheckedChange = { player.cycleRepeat() },
              shapes = IconButtonDefaults.toggleableShapes(),
            ) {
              Icon(
                painterResource(if (state.repeatMode == Player.REPEAT_MODE_ONE) R.drawable.ic_repeat_one else R.drawable.ic_repeat),
                contentDescription =
                  when (state.repeatMode) {
                    Player.REPEAT_MODE_ALL -> "循環播放：全部"
                    Player.REPEAT_MODE_ONE -> "循環播放：單曲"
                    else -> "循環播放：關閉"
                  },
              )
            }
          }
          IconButton(onClick = { queueOpen = true }, shapes = IconButtonDefaults.shapes(), modifier = Modifier.offset(x = 12.dp)) {
            Icon(painterResource(R.drawable.ic_queue_music), contentDescription = "播放佇列")
          }
        }
        Spacer(Modifier.weight(1f))
      }
    }
    if (queueOpen) {
      QueueSheet(state, onJump = player::jumpTo, onRemove = player::removeFromQueue, onDismiss = { queueOpen = false })
    }
  }
}

/** Material's bottom sheets take a flick this fast as a request to close. */
private val DismissVelocity = 125.dp

/** The wave rides the playhead while music plays and flattens on pause, like Android's media controls. */
@Composable
private fun SeekBar(fraction: Float, playing: Boolean, onScrub: (Float) -> Unit, onSeek: (Float) -> Unit) {
  val amplitude by animateFloatAsState(if (playing) 1f else 0f, label = "wave amplitude")
  val scrub by rememberUpdatedState(onScrub)
  val seek by rememberUpdatedState(onSeek)
  // The wave's amplitude is a share of the indicator's height, so the indicator keeps its own
  // 10 dp and only the surrounding box grows into a touch target.
  Box(
    Modifier.fillMaxWidth()
      .height(32.dp)
      .pointerInput(Unit) { detectTapGestures { seek((it.x / size.width).coerceIn(0f, 1f)) } }
      .pointerInput(Unit) {
        var last = 0f
        detectHorizontalDragGestures(
          onDragStart = {
            last = (it.x / size.width).coerceIn(0f, 1f)
            scrub(last)
          },
          onDragEnd = { seek(last) },
          onDragCancel = { seek(last) },
          onHorizontalDrag = { change, _ ->
            last = (change.position.x / size.width).coerceIn(0f, 1f)
            scrub(last)
          },
        )
      },
    contentAlignment = Alignment.Center,
  ) {
    LinearWavyProgressIndicator(progress = { fraction }, amplitude = { amplitude }, modifier = Modifier.fillMaxWidth())
  }
}
