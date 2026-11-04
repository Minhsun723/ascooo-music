package com.ascooo.android.music.ui.player

import androidx.compose.animation.core.AnimationSpec
import androidx.compose.animation.core.animate
import androidx.compose.foundation.background
import androidx.compose.foundation.gestures.DraggableState
import androidx.compose.foundation.gestures.Orientation
import androidx.compose.foundation.gestures.draggable
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.offset
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.MaterialTheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.derivedStateOf
import androidx.compose.runtime.Stable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableFloatStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.Saver
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.CornerRadius
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Rect
import androidx.compose.ui.geometry.RoundRect
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.geometry.lerp
import androidx.compose.ui.graphics.Outline
import androidx.compose.ui.graphics.Shape
import androidx.compose.ui.graphics.TransformOrigin
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.layout.LayoutCoordinates
import androidx.compose.ui.layout.layout
import androidx.compose.ui.layout.onGloballyPositioned
import androidx.compose.ui.layout.onPlaced
import androidx.compose.ui.layout.onSizeChanged
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.unit.Constraints
import androidx.compose.ui.unit.Density
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.IntSize
import androidx.compose.ui.unit.LayoutDirection
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.round
import androidx.compose.ui.unit.toSize
import androidx.compose.ui.util.lerp
import coil3.compose.AsyncImage
import coil3.compose.LocalPlatformContext
import coil3.request.ImageRequest
import com.ascooo.android.music.ui.components.passTouchesThrough
import kotlin.math.roundToInt

/**
 * Where Now Playing stands between the mini player and the full screen. It opens by growing out of the
 * mini player and closes by folding back into it, as Material's container transform carries one surface
 * into another: the card's bounds and corners move from one to the other while the mini player's
 * content fades out and the page's fades in.
 */
@Stable
class NowPlayingSheetState(open: Boolean) {
  var isOpen by mutableStateOf(open)
    private set

  /** Open, or still on its way into the mini player. */
  val isShown: Boolean
    get() = isOpen || fraction > 0f

  /** Where the mini player's card is on screen, for the page to grow out of and fold back into. */
  var miniBounds by mutableStateOf(Rect.Zero)

  /** From 0, folded into the mini player, to 1, the full page. */
  internal var fraction by mutableFloatStateOf(if (open) 1f else 0f)
    private set

  // How far the page's top edge travels between the two, down to the mini player's top, and how far
  // down it is now: the distance a finger pulls it.
  private val travel: Float
    get() = miniBounds.top.coerceAtLeast(1f)
  internal val pulled: Float
    get() = (1 - fraction) * travel

  // The finger moves the top edge directly. The expressive springs overshoot a little; the page stops
  // at the screen's top and the mini player rather than swelling past them.
  internal val dragState = DraggableState { delta -> fraction = (fraction - delta / travel).coerceIn(0f, 1f) }
  internal var settling by mutableStateOf(false)
    private set

  // Moving far enough to see, the page is caught by a touch. Not in the last hair of a spring's
  // settling, which lasts the best part of a second after the page looks still: a touch then belongs
  // to whatever's on the page, a swipe across the cover included.
  internal val catchable by derivedStateOf { settling && fraction > 0.001f && fraction < 0.999f }

  // The finger's speed when it lets go and sends the page on to the other end, for the spring there
  // to carry on from. Taken once, so a spring started for any other reason starts still.
  private var releaseVelocity = 0f
  internal fun takeReleaseVelocity() = releaseVelocity.also { releaseVelocity = 0f }

  /**
   * Springs the page open or into the mini player from [velocity]. It runs in the drag state too, so
   * a finger landing on the moving page takes over from where it is instead of the two cancelling
   * each other.
   */
  internal suspend fun settle(open: Boolean, velocity: Float, spec: AnimationSpec<Float>) {
    dragState.drag {
      settling = true
      try {
        animate(pulled, if (open) 0f else travel, velocity, spec) { value, _ -> dragBy(value - pulled) }
      } finally {
        settling = false
      }
    }
  }

  /**
   * Lets go of the page mid-drag, whichever end it was pulled from: a flick on, or a pull more than a
   * quarter of the way, carries it to the other end; anything less springs it back.
   */
  internal suspend fun release(velocity: Float, flick: Float, spec: AnimationSpec<Float>) {
    when {
      !isOpen && (velocity < -flick || (velocity < flick && fraction > 0.25f)) -> open(velocity)
      isOpen && (velocity > flick || (velocity > -flick && fraction < 0.75f)) -> close(velocity)
      else -> settle(isOpen, velocity, spec)
    }
  }

  /** [velocity] is the finger's, when it opens the page by letting go. */
  fun open(velocity: Float = 0f) {
    releaseVelocity = velocity
    isOpen = true
  }

  /** [velocity] is the finger's, when it closes the page by letting go. */
  fun close(velocity: Float = 0f) {
    releaseVelocity = velocity
    isOpen = false
  }

  companion object {
    val Saver = Saver<NowPlayingSheetState, Boolean>(save = { it.isOpen }, restore = { NowPlayingSheetState(it) })
  }
}

/**
 * Now Playing over the app. Pulled down, the page folds towards the mini player under the finger, all
 * the way into it at the bottom, and [rememberPullUpToOpen] lets the mini player be pulled up into it the same
 * way; let go, the page carries on or springs back as [NowPlayingSheetState.release] decides.
 *
 * On the way, the cover itself flies between the mini player's thumbnail and the page's cover, growing
 * or shrinking into place over everything else.
 *
 * [mini] is the mini player, given where to draw and a modifier for its thumbnail; [page] is laid out
 * full size and scaled to the card, and takes a modifier for its cover at the given corner radius.
 */
@Composable
fun NowPlayingSheet(
  state: NowPlayingSheetState,
  artworkUrl: String?,
  mini: @Composable (modifier: Modifier, art: Modifier) -> Unit,
  page: @Composable (cover: (corner: Dp) -> Modifier) -> Unit,
) {
  val density = LocalDensity.current
  val dismissVelocity = with(density) { DismissVelocity.toPx() }
  val miniCorner = with(density) { 20.dp.toPx() } // MaterialTheme.shapes.largeIncreased, the mini player's
  val miniArtCorner = with(density) { 12.dp.toPx() } // MaterialTheme.shapes.medium, its thumbnail's
  val maxCorner = with(density) { 28.dp.toPx() }
  val spatial = MaterialTheme.motionScheme.defaultSpatialSpec<Float>()
  var screen by remember { mutableStateOf(IntSize.Zero) }
  val miniArt = remember { CoverSpot() }
  val pageCover = remember { CoverSpot() }

  // Shown by a pull up from the mini player, the page isn't open yet and this finds the finger still
  // holding it: a drag outranks a spring, so the spring gives way.
  LaunchedEffect(state.isOpen) { state.settle(state.isOpen, state.takeReleaseVelocity(), spatial) }

  // The card on screen this frame: the mini player's, the whole screen, or on its way between the two.
  fun card(screen: Size) = lerp(state.miniBounds, Rect(Offset.Zero, screen), state.fraction)

  // Only on the way between the two; at either end the real covers show.
  fun inFlight() =
    artworkUrl != null && state.fraction > 0f && state.fraction < 1f && miniArt.bounds != Rect.Zero && pageCover.bounds != Rect.Zero

  Box(
    Modifier.fillMaxSize()
      .onSizeChanged { screen = it }
      // Folding away, it takes no more touches; the app under it already does.
      .passTouchesThrough(!state.isOpen)
      // Ahead of the layer, so the finger is measured against the screen rather than the moving card.
      .draggable(
        state = state.dragState,
        orientation = Orientation.Vertical,
        startDragImmediately = state.catchable,
        onDragStopped = { velocity -> state.release(velocity, dismissVelocity, spatial) },
      )
  ) {
    Box(
      Modifier.fillMaxSize()
        .graphicsLayer {
          val card = card(size)
          val scale = card.width / size.width
          transformOrigin = TransformOrigin(0f, 0f)
          scaleX = scale
          scaleY = scale
          translationX = card.left
          translationY = card.top
          // Rounding off quickly as the page is first pulled, like a card lifting, then to the mini player's.
          val corner = lerp(miniCorner, (state.pulled / 4).coerceAtMost(maxCorner), state.fraction)
          shape = CardOutline(card.height / scale, corner / scale)
          clip = true
        }
        // The mini player's colour, under the page as it fades in.
        .background(MaterialTheme.colorScheme.surfaceContainerHigh)
    ) {
      Box(Modifier.coverCard(pageCover).graphicsLayer { alpha = ((state.fraction - 0.2f) / 0.4f).coerceIn(0f, 1f) }) {
        page { corner -> Modifier.coverSpot(pageCover, with(density) { corner.toPx() }, ::inFlight) }
      }
    }
    // The mini player's own content, riding the card's top edge as it fades out.
    mini(
      Modifier.offset { card(screen.toSize()).topLeft.round() }
        .width(with(density) { state.miniBounds.width.toDp() })
        .coverCard(miniArt)
        .graphicsLayer { alpha = (1 - state.fraction / 0.2f).coerceIn(0f, 1f) },
      Modifier.coverSpot(miniArt, miniArtCorner, ::inFlight),
    )
    if (artworkUrl != null) {
      FlyingCover(artworkUrl, from = miniArt, to = pageCover, progress = { state.fraction }, inFlight = ::inFlight) {
        // Both ends move with the card: the thumbnail rides its top edge, the page's cover is scaled with it.
        val card = card(screen.toSize())
        val scale = card.width / screen.width
        val to = pageCover.bounds.let { Rect(card.topLeft + it.topLeft * scale, it.size * scale) }
        lerp(miniArt.bounds.translate(card.topLeft), to, state.fraction)
      }
    }
  }
}

/**
 * For the mini player: pulled up, Now Playing grows out of it under the finger, the way pulling the page
 * down folds it back in. A touch on it while the page is still folding away catches the page there.
 */
@Composable
fun rememberPullUpToOpen(state: NowPlayingSheetState): Modifier {
  val flick = with(LocalDensity.current) { DismissVelocity.toPx() }
  val spatial = MaterialTheme.motionScheme.defaultSpatialSpec<Float>()
  return remember(state, flick, spatial, state.catchable) {
    Modifier.draggable(
      state = state.dragState,
      orientation = Orientation.Vertical,
      startDragImmediately = state.catchable,
      onDragStopped = { velocity -> state.release(velocity, flick, spatial) },
    )
  }
}

/** Where a cover sits inside its card and how round it is, for the cover in flight to leave or land there. */
private class CoverSpot {
  /** The card, as laid out before the sheet scales it. */
  var card: LayoutCoordinates? = null
  var bounds by mutableStateOf(Rect.Zero)
  var corner = 0f
}

private fun Modifier.coverCard(spot: CoverSpot) = onPlaced { spot.card = it }

/** Reports where this cover is, and hides it while the one in flight stands in for it. */
private fun Modifier.coverSpot(spot: CoverSpot, corner: Float, inFlight: () -> Boolean) =
  onGloballyPositioned { cover ->
    spot.card?.let { spot.bounds = it.localBoundingBoxOf(cover, clipBounds = false) }
    spot.corner = corner
  }
    .graphicsLayer { alpha = if (inFlight()) 0f else 1f }

/**
 * The cover on its way between [from] and [to], over everything else. It's laid out at the page cover's
 * size, so it stays sharp there, and drawn scaled down to wherever [bounds] has it on screen, its
 * corners rounding between the two by [progress]. Until the full-size image is decoded, the
 * thumbnail's smaller copy from the memory cache stands in.
 */
@Composable
private fun FlyingCover(
  url: String,
  from: CoverSpot,
  to: CoverSpot,
  progress: () -> Float,
  inFlight: () -> Boolean,
  bounds: () -> Rect,
) {
  val context = LocalPlatformContext.current
  val request = remember(url) { ImageRequest.Builder(context).data(url).placeholderMemoryCacheKey(url).build() }
  Box(
    Modifier.layout { measurable, _ ->
      val size = to.bounds.size
      val placeable = measurable.measure(Constraints.fixed(size.width.roundToInt(), size.height.roundToInt()))
      layout(placeable.width, placeable.height) { placeable.place(0, 0) }
    }
      .graphicsLayer {
        if (!inFlight() || size.width == 0f) {
          alpha = 0f
          return@graphicsLayer
        }
        alpha = 1f
        val now = bounds()
        val scale = now.width / size.width
        transformOrigin = TransformOrigin(0f, 0f)
        translationX = now.left
        translationY = now.top
        scaleX = scale
        scaleY = now.height / size.height
        shape = RoundedCornerShape(lerp(from.corner, to.corner, progress()) / scale)
        clip = true
      }
      .background(MaterialTheme.colorScheme.surfaceContainerHigh)
  ) {
    AsyncImage(request, contentDescription = null, contentScale = ContentScale.Crop, modifier = Modifier.fillMaxSize())
  }
}

/** The card cut from the page, in the page's own coordinates: its full width, the card's height. */
private class CardOutline(private val height: Float, private val corner: Float) : Shape {
  override fun createOutline(size: Size, layoutDirection: LayoutDirection, density: Density) =
    Outline.Rounded(RoundRect(0f, 0f, size.width, height, CornerRadius(corner)))
}

/** Material's bottom sheets take a flick this fast as a request to close. */
private val DismissVelocity = 125.dp
