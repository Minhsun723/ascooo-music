package com.ascooo.android.music.ui.player

import androidx.compose.animation.core.animate
import androidx.compose.foundation.gestures.Orientation
import androidx.compose.foundation.gestures.draggable
import androidx.compose.foundation.gestures.rememberDraggableState
import androidx.compose.foundation.layout.Box
import androidx.compose.material3.MaterialTheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.derivedStateOf
import androidx.compose.runtime.getValue
import androidx.compose.runtime.key
import androidx.compose.runtime.mutableFloatStateOf
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.layout.Layout
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.platform.LocalWindowInfo
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.media3.common.Player
import kotlin.math.roundToInt
import kotlinx.coroutines.delay

/**
 * The current track with the previous and next in the queue beside it, out of sight, so a swipe brings
 * either in: the strip follows the finger, and let go a third of the way across or flicked, the
 * neighbour settles in the middle and the player skips to it at once; anything less springs back. One
 * swipe moves one track at most, and a swipe landing on a strip still settling carries on from the
 * track it's settling on. Where there's no neighbour the strip only gives a little.
 *
 * [content] draws one track the size of the strip: the current one for null, otherwise that entry.
 * Each keeps its place in composition as it moves between the middle and the sides, so a cover already
 * loaded beside the current one stays loaded once it plays.
 *
 * The neighbours sit [gap] away, or with [pastScreenEdges], for a strip centred on the screen, just
 * beyond its edges however wide the strip is, so they come in from off screen.
 */
@Composable
fun TrackSwipe(
  state: PlayerUiState,
  onSkip: (index: Int) -> Unit,
  modifier: Modifier = Modifier,
  gap: Dp = 0.dp,
  pastScreenEdges: Boolean = false,
  enabled: Boolean = true,
  content: @Composable (entry: QueueEntry?) -> Unit,
) {
  // Places in the order the queue will play, wrapping round when it repeats as a whole, as the
  // player skips.
  val queue = state.queue
  val wraps = state.repeatMode == Player.REPEAT_MODE_ALL && queue.size > 1
  val current = queue.indexOfFirst { it.index == state.currentIndex }
  fun entryAt(place: Int): QueueEntry? =
    when {
      current < 0 -> null
      place in queue.indices -> queue[place]
      wraps -> queue[place.mod(queue.size)]
      else -> null
    }

  val density = LocalDensity.current
  val screenWidth = LocalWindowInfo.current.containerSize.width
  val flick = with(density) { SkipVelocity.toPx() }
  val spatial = MaterialTheme.motionScheme.defaultSpatialSpec<Float>()
  var width by remember { mutableFloatStateOf(0f) }
  val gapPx = with(density) { gap.toPx() }.let { if (pastScreenEdges) maxOf(it, (screenWidth - width) / 2) else it }
  val span = (width + gapPx).coerceAtLeast(1f)

  // Where the strip stands, as a place in the queue: the current track's at rest, between two while
  // it moves. Unlike an offset from the current track it means the same before and after the player
  // gets to the track a swipe asked for, so the player can get there whenever it does.
  var position by remember { mutableFloatStateOf(current.toFloat()) }
  val middle by remember { derivedStateOf { position.roundToInt() } }
  var moving by remember { mutableStateOf(false) }
  var swipeFrom by remember { mutableIntStateOf(0) }
  var asked by remember { mutableStateOf<Int?>(null) }
  // At rest it shows what the player plays, skipped there by a swipe or anything else. Let go on a
  // track the player hasn't reached yet, it gives the player a moment, then goes back to what plays.
  LaunchedEffect(current, moving) {
    if (moving) return@LaunchedEffect
    if (asked != null && asked != state.currentIndex) delay(2000)
    asked = null
    position = current.toFloat()
  }

  val dragState = rememberDraggableState { delta ->
    // Towards a side with no track it gives a third as much, and only a little.
    val step = -delta / span
    val towardsNext = position + step > swipeFrom
    val open = entryAt(if (towardsNext) swipeFrom + 1 else swipeFrom - 1) != null
    val reach = if (open) 1f else 0.2f
    position = (position + if (open) step else step / 3).coerceIn(swipeFrom - reach, swipeFrom + reach)
  }

  Layout(
    content = {
      for (place in middle - 1..middle + 1) {
        key(place) {
          Box {
            // A current track not found in the queue still shows, with nothing beside it.
            if (place == current || (current < 0 && place == middle)) content(null) else entryAt(place)?.let { content(it) }
          }
        }
      }
    },
    modifier =
      modifier.draggable(
        state = dragState,
        orientation = Orientation.Horizontal,
        enabled = enabled,
        onDragStarted = {
          moving = true
          swipeFrom = position.roundToInt()
        },
        onDragStopped = { velocity ->
          val from = swipeFrom
          val moved = position - from
          val target =
            when {
              entryAt(from + 1) != null && velocity <= flick && (moved > 1 / 3f || velocity < -flick) -> from + 1
              entryAt(from - 1) != null && velocity >= -flick && (moved < -1 / 3f || velocity > flick) -> from - 1
              else -> from
            }
          // The song changes as the strip settles, not after.
          entryAt(target)?.takeIf { it.index != state.currentIndex }?.let {
            asked = it.index
            onSkip(it.index)
          }
          // In pixels, so the spring settles to within one. Run in the drag state, so a finger landing
          // on the moving strip takes it over; then it's still moving, and only finishing ends that.
          dragState.drag {
            animate(position * span, target * span, -velocity, spatial) { value, _ ->
              position = (value / span).coerceIn(from - 1f, from + 1f)
            }
          }
          moving = false
        },
      ),
  ) { measurables, constraints ->
    val placeables = measurables.map { it.measure(constraints) }
    val centre = placeables[1]
    width = centre.width.toFloat()
    layout(centre.width, centre.height) {
      placeables.forEachIndexed { slot, placeable ->
        val x = ((middle - 1 + slot - position) * span).roundToInt()
        // At rest only the middle one is placed. Its neighbours would have nowhere safe to sit: the
        // cover shrinking into the lyrics' header, say, is no longer centred on the screen. Measured
        // all the same, they keep their covers loaded for the next swipe.
        if (moving || x == 0) placeable.place(x, 0)
      }
    }
  }
}

/** As fast a flick as the pager in Compose takes as a request for the next page. */
private val SkipVelocity = 400.dp
