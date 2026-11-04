package com.ascooo.android.music.ui.player

import androidx.compose.animation.AnimatedContent
import androidx.compose.animation.Crossfade
import androidx.compose.animation.EnterExitState
import androidx.compose.animation.SharedTransitionLayout
import androidx.compose.animation.SizeTransform
import androidx.compose.animation.core.animateDp
import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.slideInVertically
import androidx.compose.animation.slideOutVertically
import androidx.compose.animation.togetherWith
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.gestures.awaitEachGesture
import androidx.compose.foundation.gestures.awaitFirstDown
import androidx.compose.foundation.gestures.detectHorizontalDragGestures
import androidx.compose.foundation.gestures.detectTapGestures
import androidx.compose.foundation.interaction.MutableInteractionSource
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
import androidx.compose.material3.ButtonGroup
import androidx.compose.material3.ButtonGroupDefaults
import androidx.compose.material3.ButtonGroupScope
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.FilledIconToggleButton
import androidx.compose.material3.FilledTonalIconButton
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.IconButtonDefaults
import androidx.compose.material3.IconToggleButton
import androidx.compose.material3.LinearProgressIndicator
import androidx.compose.material3.LinearWavyProgressIndicator
import androidx.compose.material3.LocalContentColor
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.State
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableLongStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.produceState
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberUpdatedState
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.clipToBounds
import androidx.compose.ui.geometry.Rect
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Shape
import androidx.compose.ui.input.pointer.PointerEventPass
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalView
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.IntOffset
import androidx.compose.ui.unit.IntSize
import androidx.compose.ui.unit.dp
import androidx.media3.common.Player
import com.ascooo.android.music.R
import com.ascooo.android.music.ui.components.Artwork
import com.ascooo.android.music.ui.components.LikeButton
import com.ascooo.android.music.ui.components.formatTime
import com.ascooo.android.music.ui.lyrics.LyricsPanel
import com.ascooo.android.music.ui.theme.CoverColors
import com.ascooo.android.music.ui.theme.animateCoverColors
import com.ascooo.android.music.ui.theme.cachedCoverColors
import com.ascooo.android.music.ui.theme.coverColors
import kotlinx.coroutines.delay

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
fun MiniPlayer(
  state: PlayerUiState,
  player: PlayerViewModel,
  onOpen: () -> Unit,
  modifier: Modifier = Modifier,
  artModifier: Modifier = Modifier,
  swipe: Boolean = true,
) {
  val now = state.nowPlaying ?: return
  val position by rememberPosition(player, state)
  Surface(
    onClick = onOpen,
    shape = MaterialTheme.shapes.largeIncreased,
    color = MaterialTheme.colorScheme.surfaceContainerHigh,
    modifier = modifier.fillMaxWidth(),
  ) {
    Column {
      Row(Modifier.padding(end = 4.dp, top = 8.dp, bottom = 6.dp), verticalAlignment = Alignment.CenterVertically) {
        // Swiped sideways, the track slides away under the buttons, which stay put, and the next or
        // previous slides in; cut off at the card's edge and short of the buttons.
        TrackSwipe(state, player::skipTo, Modifier.weight(1f).clipToBounds(), gap = 16.dp, enabled = swipe) { entry ->
          Row(Modifier.fillMaxWidth().padding(start = 8.dp), verticalAlignment = Alignment.CenterVertically) {
            Artwork(
              (entry?.artworkUri ?: now.artworkUri)?.toString(),
              Modifier.size(44.dp).then(if (entry == null) artModifier else Modifier),
              MaterialTheme.shapes.medium,
            )
            Spacer(Modifier.width(12.dp))
            Column(Modifier.weight(1f)) {
              Text(entry?.title ?: now.title, style = MaterialTheme.typography.bodyLargeEmphasized, maxLines = 1, overflow = TextOverflow.Ellipsis)
              val error = state.error.takeIf { entry == null }
              Text(
                error ?: entry?.artist ?: now.artist,
                style = MaterialTheme.typography.bodyMedium,
                color = if (error != null) MaterialTheme.colorScheme.error else MaterialTheme.colorScheme.onSurfaceVariant,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
              )
            }
          }
        }
        IconButton(onClick = player::togglePlayPause, shapes = IconButtonDefaults.shapes()) {
          PlayPauseIcon(state, IconButtonDefaults.mediumIconSize)
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
fun NowPlayingScreen(
  state: PlayerUiState,
  player: PlayerViewModel,
  onCollapse: () -> Unit,
  lyricsShown: Boolean,
  onLyricsShownChange: (Boolean) -> Unit,
  modifier: Modifier = Modifier,
  coverModifier: (corner: Dp) -> Modifier = { Modifier },
) {
  val now = state.nowPlaying ?: return
  val position by rememberPosition(player, state)
  // Lyrics on screen keep it from dimming while the song plays, so they stay readable.
  val view = LocalView.current
  DisposableEffect(view, lyricsShown && state.isPlaying) {
    view.keepScreenOn = lyricsShown && state.isPlaying
    onDispose { view.keepScreenOn = false }
  }
  var scrubbing by remember { mutableStateOf<Float?>(null) }
  var queueOpen by rememberSaveable { mutableStateOf(false) }
  val duration = state.durationMs.coerceAtLeast(1)
  val fraction = scrubbing ?: (position.toFloat() / duration).coerceIn(0f, 1f)

  // With the lyrics up and the song playing, the controls shrink to a button group after a few seconds
  // untouched and the lyrics take the room they leave. A touch on the lyrics or the controls brings
  // them back; the button group plays and skips without doing so. A finger still down keeps them, so a
  // slow drag along the seek bar doesn't lose it.
  var controlsShown by remember { mutableStateOf(true) }
  var touches by remember { mutableIntStateOf(0) }
  var touching by remember { mutableStateOf(false) }
  // Buffering into the next song still counts as playing, so skipping from the button group keeps it.
  val playing = !state.showPlayButton
  LaunchedEffect(lyricsShown, playing, touches, touching) {
    controlsShown = true
    if (lyricsShown && playing && !touching) {
      delay(CONTROLS_IDLE_MS)
      controlsShown = false
    }
  }
  // Notices a touch without taking it from whatever it lands on.
  val noticeTouches =
    Modifier.pointerInput(Unit) {
      awaitEachGesture {
        awaitFirstDown(requireUnconsumed = false, pass = PointerEventPass.Initial)
        touching = true
        touches++
        try {
          do {
            val event = awaitPointerEvent(PointerEventPass.Initial)
          } while (event.changes.any { it.pressed })
        } finally {
          touching = false
        }
      }
    }

  // Coloured after the cover. Until a cover's colours are worked out the previous ones stay, and a
  // cover with none keeps the app's palette on a plain backdrop.
  val context = LocalContext.current
  val artworkUrl = now.artworkUri?.toString()
  val appColors = CoverColors(MaterialTheme.colorScheme, MaterialTheme.colorScheme.surface)
  val cover by produceState(artworkUrl?.let(::cachedCoverColors), artworkUrl) { value = artworkUrl?.let { coverColors(context, it) } }
  val colors = animateCoverColors(cover ?: appColors)

  MaterialTheme(colorScheme = colors.scheme) {
    Surface(modifier.fillMaxSize(), color = MaterialTheme.colorScheme.surface) {
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
        // The cover, or the lyrics under the cover shrunk to a header. The cover itself moves and resizes
        // between the two, its corners rounding to suit; the rest fades across.
        val fadeInSpec = MaterialTheme.motionScheme.defaultEffectsSpec<Float>()
        val fadeOutSpec = MaterialTheme.motionScheme.fastEffectsSpec<Float>()
        val coverBounds = MaterialTheme.motionScheme.defaultSpatialSpec<Rect>()
        val bigCorner = 32.dp // MaterialTheme.shapes.extraLargeIncreased
        val smallCorner = 12.dp // MaterialTheme.shapes.medium
        SharedTransitionLayout(Modifier.weight(1f).then(noticeTouches)) {
          AnimatedContent(
            targetState = lyricsShown,
            // Unclipped, so the lyrics' glow can reach into the page's side padding.
            transitionSpec = { (fadeIn(fadeInSpec) togetherWith fadeOut(fadeOutSpec)).using(SizeTransform(clip = false)) },
            modifier = Modifier.fillMaxSize(),
            label = "cover or lyrics",
          ) { showLyrics ->
            val sharedCover =
              Modifier.sharedElement(
                rememberSharedContentState("cover"),
                animatedVisibilityScope = this@AnimatedContent,
                boundsTransform = { _, _ -> coverBounds },
              )
            val corner by transition.animateDp(label = "cover corner") { stage ->
              when {
                stage == EnterExitState.Visible -> if (showLyrics) smallCorner else bigCorner
                showLyrics -> bigCorner
                else -> smallCorner
              }
            }
            if (showLyrics) {
              Column(Modifier.fillMaxSize()) {
                LyricsHeader(now, sharedCover.then(coverModifier(corner)), RoundedCornerShape(corner), onClose = { onLyricsShownChange(false) })
                LyricsPanel(
                  // A song without lyrics is known to have none; there's nothing to ask for.
                  trackId = now.mediaId.toLongOrNull()?.takeIf { now.hasLyrics },
                  atmos = now.atmos,
                  state = state,
                  player = player,
                  modifier = Modifier.weight(1f),
                  // The page's side padding, for the glow beside the lines to spill into.
                  bleed = 24.dp,
                )
              }
            } else {
              Column(Modifier.fillMaxSize(), verticalArrangement = Arrangement.Center) {
                // Full width where the screen is tall enough; on a short one the cover gives up the height
                // the controls need, staying square. Swiped sideways, it goes off screen and the next or
                // previous track's cover comes in from the other side.
                TrackSwipe(
                  state,
                  player::skipTo,
                  Modifier.align(Alignment.CenterHorizontally)
                    .weight(1f, fill = false)
                    .fillMaxWidth()
                    .aspectRatio(1f)
                    .then(sharedCover)
                    .then(coverModifier(corner)),
                  pastScreenEdges = true,
                ) { entry ->
                  Artwork((entry?.artworkUri ?: now.artworkUri)?.toString(), Modifier.fillMaxSize(), RoundedCornerShape(corner))
                }
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
              }
            }
          }
        }
        state.error?.let {
          Text(it, style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.error, modifier = Modifier.padding(top = 8.dp))
        }
        // The seek bar stays either way. While the controls are shrunk it scrubs without bringing them
        // back, so the bar doesn't jump up under the finger as they open beneath it.
        Column(if (controlsShown) noticeTouches else Modifier) {
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
        }
        // Under it, the controls or the button group they shrink to: either one sinks out of sight
        // downwards as the other rises in its place, the space between them closing or opening for the
        // lyrics.
        val controlsSize = MaterialTheme.motionScheme.defaultSpatialSpec<IntSize>()
        val controlsOffset = MaterialTheme.motionScheme.defaultSpatialSpec<IntOffset>()
        AnimatedContent(
          targetState = controlsShown,
          modifier = Modifier.fillMaxWidth(),
          transitionSpec = {
            (slideInVertically(controlsOffset) { it } + fadeIn(fadeInSpec))
              .togetherWith(slideOutVertically(controlsOffset) { it } + fadeOut(fadeOutSpec))
              .using(SizeTransform { _, _ -> controlsSize })
          },
          contentAlignment = Alignment.BottomCenter,
          label = "controls or button group",
        ) { full ->
          if (!full) {
            CompactControls(state, player, lyricsShown, onLyricsShownChange)
            return@AnimatedContent
          }
          Column(noticeTouches) {
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
              PlayPauseButton(state, player, IconButtonDefaults.extraLargeIconSize, Modifier.size(IconButtonDefaults.extraLargeContainerSize()))
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
              Row(Modifier.offset(x = 12.dp)) {
                LyricsToggle(lyricsShown, onLyricsShownChange)
                IconButton(onClick = { queueOpen = true }, shapes = IconButtonDefaults.shapes()) {
                  Icon(painterResource(R.drawable.ic_queue_music), contentDescription = "播放佇列")
                }
              }
            }
          }
        }
        Spacer(Modifier.height(16.dp))
      }
    }
    if (queueOpen) {
      QueueSheet(state, onJump = player::jumpTo, onRemove = player::removeFromQueue, onDismiss = { queueOpen = false })
    }
  }
}

/**
 * Expressive toggle: round while paused, morphing to a rounded square while playing. Both states keep
 * the filled primary colour (white on the brand palette), so paused never reads as disabled.
 */
@Composable
private fun PlayPauseButton(
  state: PlayerUiState,
  player: PlayerViewModel,
  iconSize: Dp,
  modifier: Modifier = Modifier,
  interactionSource: MutableInteractionSource? = null,
) {
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
    modifier = modifier,
    interactionSource = interactionSource,
  ) {
    PlayPauseIcon(state, iconSize)
  }
}

/**
 * Play or pause, or while the track loads to play, a spinner in the icon's place. Paused, loading
 * ahead keeps the play icon, as Media3's own player view does. Loads shorter than
 * [LOADING_SHOWN_AFTER_MS], such as a seek within what's already buffered, keep the icon rather than
 * flash the spinner. The button still plays and pauses either way, and says which it will.
 */
@Composable
private fun PlayPauseIcon(state: PlayerUiState, size: Dp) {
  val waiting = state.isBuffering && !state.showPlayButton
  val loading by produceState(false, waiting) {
    if (waiting) delay(LOADING_SHOWN_AFTER_MS)
    value = waiting
  }
  val label = if (state.showPlayButton) "播放" else "暫停"
  Crossfade(loading, animationSpec = MaterialTheme.motionScheme.fastEffectsSpec(), label = "play icon or spinner") { spinning ->
    Box(Modifier.size(size), contentAlignment = Alignment.Center) {
      if (spinning) {
        // A little inside the icon's box, as the glyphs are, so it sits the same size.
        CircularProgressIndicator(
          modifier = Modifier.size(size * 0.8f).semantics { contentDescription = label },
          color = LocalContentColor.current,
          strokeWidth = size / 10,
        )
      } else {
        Icon(painterResource(if (state.showPlayButton) R.drawable.ic_play else R.drawable.ic_pause), contentDescription = label, modifier = Modifier.fillMaxSize())
      }
    }
  }
}

@Composable
private fun LyricsToggle(shown: Boolean, onShownChange: (Boolean) -> Unit, modifier: Modifier = Modifier) {
  IconToggleButton(checked = shown, onCheckedChange = onShownChange, shapes = IconButtonDefaults.toggleableShapes(), modifier = modifier) {
    Icon(painterResource(R.drawable.ic_lyrics), contentDescription = if (shown) "隱藏歌詞" else "歌詞")
  }
}

/**
 * What the controls shrink to under the lyrics: an expressive button group, the play button the wide
 * one in the middle, with the lyrics button kept on the right where it was. A pressed button in the
 * group widens and squeezes its neighbours.
 */
@Composable
private fun CompactControls(state: PlayerUiState, player: PlayerViewModel, lyricsShown: Boolean, onLyricsShownChange: (Boolean) -> Unit) {
  Box(Modifier.fillMaxWidth().padding(top = 12.dp), contentAlignment = Alignment.Center) {
    CompactButtonGroup(state, player)
    LyricsToggle(lyricsShown, onLyricsShownChange, Modifier.align(Alignment.CenterEnd).offset(x = 12.dp))
  }
}

@Composable
private fun CompactButtonGroup(state: PlayerUiState, player: PlayerViewModel) {
  // Three buttons always fit, so nothing ever overflows into the group's menu.
  ButtonGroup(overflowIndicator = { ButtonGroupDefaults.OverflowIndicator(it) }) {
    customItem(buttonGroupContent = { SkipButton(R.drawable.ic_skip_previous, "上一首", player::previous) }, menuContent = {})
    customItem(
      buttonGroupContent = {
        val interaction = remember { MutableInteractionSource() }
        PlayPauseButton(
          state,
          player,
          IconButtonDefaults.mediumIconSize,
          Modifier.animateWidth(interaction).size(IconButtonDefaults.mediumContainerSize(IconButtonDefaults.IconButtonWidthOption.Wide)),
          interaction,
        )
      },
      menuContent = {},
    )
    customItem(buttonGroupContent = { SkipButton(R.drawable.ic_skip_next, "下一首", player::next) }, menuContent = {})
  }
}

@Composable
private fun ButtonGroupScope.SkipButton(icon: Int, label: String, onClick: () -> Unit) {
  val interaction = remember { MutableInteractionSource() }
  FilledTonalIconButton(
    onClick = onClick,
    shapes = IconButtonDefaults.shapes(),
    modifier = Modifier.animateWidth(interaction).size(IconButtonDefaults.mediumContainerSize()),
    interactionSource = interaction,
  ) {
    Icon(painterResource(icon), contentDescription = label, modifier = Modifier.size(IconButtonDefaults.mediumIconSize))
  }
}

/** With the lyrics up, the cover and title shrink to one row above them. Tapping it brings the cover back. */
@Composable
private fun LyricsHeader(now: NowPlaying, cover: Modifier, coverShape: Shape, onClose: () -> Unit) {
  Row(Modifier.padding(top = 8.dp, bottom = 4.dp), verticalAlignment = Alignment.CenterVertically) {
    Row(
      Modifier.weight(1f).clip(MaterialTheme.shapes.medium).clickable(onClickLabel = "隱藏歌詞", onClick = onClose),
      verticalAlignment = Alignment.CenterVertically,
    ) {
      Artwork(now.artworkUri?.toString(), Modifier.size(56.dp).then(cover), coverShape)
      Spacer(Modifier.width(16.dp))
      Column(Modifier.weight(1f)) {
        Text(now.title, style = MaterialTheme.typography.titleMediumEmphasized, maxLines = 1, overflow = TextOverflow.Ellipsis)
        Text(
          now.artist,
          style = MaterialTheme.typography.bodyMedium,
          color = MaterialTheme.colorScheme.onSurfaceVariant,
          maxLines = 1,
          overflow = TextOverflow.Ellipsis,
        )
      }
    }
    now.mediaId.toLongOrNull()?.let { LikeButton(it, now.liked, Modifier.offset(x = 12.dp)) }
  }
}

/** How long the controls stay under the lyrics without a touch. */
private const val CONTROLS_IDLE_MS = 4000L

/** How long the player has to be loading before the play button shows it. */
private const val LOADING_SHOWN_AFTER_MS = 250L

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
