package com.ascooo.android.music.ui.lyrics

import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.animateColorAsState
import androidx.compose.animation.core.Animatable
import androidx.compose.animation.core.CubicBezierEasing
import androidx.compose.animation.core.Easing
import androidx.compose.animation.core.RepeatMode
import androidx.compose.animation.core.animateFloat
import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.animation.core.infiniteRepeatable
import androidx.compose.animation.core.rememberInfiniteTransition
import androidx.compose.animation.core.spring
import androidx.compose.animation.core.tween
import androidx.compose.animation.expandVertically
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.shrinkVertically
import androidx.compose.foundation.ScrollState
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.gestures.scrollBy
import androidx.compose.foundation.interaction.DragInteraction
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.itemsIndexed
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DoubleState
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.derivedStateOf
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableDoubleStateOf
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableLongStateOf
import androidx.compose.runtime.mutableStateListOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.produceState
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.rememberUpdatedState
import androidx.compose.runtime.setValue
import androidx.compose.runtime.snapshotFlow
import androidx.compose.runtime.withFrameMillis
import androidx.compose.runtime.withFrameNanos
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.BlurredEdgeTreatment
import androidx.compose.ui.draw.blur
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.drawBehind
import androidx.compose.ui.draw.drawWithContent
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Rect
import androidx.compose.ui.graphics.BlendMode
import androidx.compose.ui.graphics.BlurEffect
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.CompositingStrategy
import androidx.compose.ui.graphics.RenderEffect
import androidx.compose.ui.graphics.Shadow
import androidx.compose.ui.graphics.TileMode
import androidx.compose.ui.graphics.TransformOrigin
import androidx.compose.ui.graphics.drawscope.DrawScope
import androidx.compose.ui.graphics.drawscope.clipRect
import androidx.compose.ui.graphics.drawscope.withTransform
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.graphics.lerp
import androidx.compose.ui.layout.layout
import androidx.compose.ui.layout.onPlaced
import androidx.compose.ui.layout.positionInParent
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.text.TextLayoutResult
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.drawText
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.em
import androidx.compose.ui.unit.sp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.ascooo.android.music.R
import com.ascooo.android.music.appContainer
import com.ascooo.android.music.data.Lyrics
import com.ascooo.android.music.data.LyricsFont
import com.ascooo.android.music.ui.components.Load
import com.ascooo.android.music.ui.components.loadOf
import com.ascooo.android.music.ui.player.PlayerUiState
import com.ascooo.android.music.ui.player.PlayerViewModel
import kotlin.math.PI
import kotlin.math.abs
import kotlin.math.cos
import kotlin.math.max
import kotlin.math.min
import kotlin.math.roundToInt
import kotlin.math.sin
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

// The website's SyncedLyrics, in its scrolling mode. The immersive styles aren't here yet.

/** How long the listener's own scrolling holds off following the song. */
private const val USER_SCROLL_IDLE_MS = 2600L
private const val WAVE_BEFORE = 2
private const val WAVE_AFTER = 10
private const val WAVE_STAGGER_MS = 50f
private const val WAVE_MS = 900f
private const val WAVE_SPAN_NS = ((WAVE_BEFORE + WAVE_AFTER) * WAVE_STAGGER_MS + WAVE_MS).toLong() * 1_000_000
private const val MAX_BLUR_DISTANCE = 5
private val BlurPerLine = 0.7.dp
/** How far the lyrics' clock may drift from the player's before it stops easing and jumps. */
private const val CLOCK_JUMP = 0.5
/** The share of the drift made up each frame: about a tenth of a second to settle a correction. */
private const val CLOCK_EASE = 0.1
/** The website's --now-glow opacity. */
private const val GLOW_ALPHA = 0.42f
// Blur radii matching the website's text-shadow blurs (30px for a line, 36px under timed words):
// CSS takes those as twice the standard deviation, Android's blur radius as about 1.7 times it.
private val LineGlowBlur = 26.dp
private val WordGlowBlur = 31.dp
/** Seconds the interlude dots spend shrinking away before the next line. */
private const val INTERLUDE_OUT = 0.45

private class ParsedLyrics(val trackId: Long?, val lines: List<LyricLine>, val plain: List<String>)

private suspend fun parse(trackId: Long?, lyrics: Lyrics?, spatial: Boolean) =
  withContext(Dispatchers.Default) {
    when {
      lyrics == null -> ParsedLyrics(trackId, emptyList(), emptyList())
      lyrics.synced ->
        ParsedLyrics(
          trackId,
          withInterludes(if (lyrics.format == "ttml") parseTtml(lyrics.content, spatial) else parseLrc(lyrics.content)),
          emptyList(),
        )
      else -> ParsedLyrics(trackId, emptyList(), plainLines(lyrics.content))
    }
  }

/**
 * Widens this by [bleed] on each side. The text keeps its place, padded back in by the same amount,
 * but the glow and blur around it can spill into the page's margin instead of being cut off at the
 * text's edge, as the website's --glow-bleed does.
 */
private fun Modifier.bleed(bleed: Dp): Modifier =
  layout { measurable, constraints ->
    val extra = (bleed * 2).roundToPx()
    val placeable = measurable.measure(constraints.copy(minWidth = constraints.minWidth + extra, maxWidth = constraints.maxWidth + extra))
    layout(constraints.maxWidth, placeable.height) { placeable.place(-extra / 2, 0) }
  }

/**
 * The playing song's lyrics. Synced ones follow the song line by line, and word by word where
 * Apple's TTML times each word; plain ones just scroll. [bleed] is the page margin beside the panel,
 * which the glow around the lines may use.
 */
@Composable
fun LyricsPanel(
  trackId: Long?,
  atmos: Boolean,
  state: PlayerUiState,
  player: PlayerViewModel,
  modifier: Modifier = Modifier,
  bleed: Dp = 0.dp,
) {
  val container = LocalContext.current.appContainer
  val font by container.settings.lyricsFont.collectAsStateWithLifecycle(initialValue = LyricsFont.Sans)
  var attempt by remember { mutableIntStateOf(0) }
  val lyrics by
    produceState<Load<ParsedLyrics>>(Load.Loading, trackId, atmos, attempt) {
      if (trackId == null) {
        value = Load.Ready(ParsedLyrics(null, emptyList(), emptyList()))
        return@produceState
      }
      if (container.lyrics.cached(trackId) == null) value = Load.Loading
      value = loadOf { parse(trackId, container.lyrics.get(trackId), atmos) }
    }

  val panel = modifier.bleed(bleed)
  when (val load = lyrics) {
    is Load.Failed -> LyricsMessage("無法載入歌詞", load.message, onRetry = { attempt++ }, panel.padding(horizontal = bleed))
    is Load.Ready if load.data.trackId == trackId ->
      when {
        load.data.lines.isNotEmpty() -> SyncedLyrics(load.data.lines, state, player, font.fontFamily, bleed, panel)
        load.data.plain.isNotEmpty() -> PlainLyrics(load.data.plain, font.fontFamily, bleed, panel)
        else -> LyricsMessage("這首歌還沒有歌詞", null, null, panel.padding(horizontal = bleed))
      }
    // Loading, or the previous song's still on hand while this one's arrive.
    else -> LyricsSkeleton(panel.padding(horizontal = bleed))
  }
}

private fun lyricStyle(font: FontFamily) =
  TextStyle(fontFamily = font, fontWeight = FontWeight.Bold, fontSize = 30.sp, lineHeight = 1.3.em, letterSpacing = 0.02.em)

/** The list fades out at its edges instead of being cut off. */
private fun Modifier.fadeEdges(): Modifier =
  graphicsLayer { compositingStrategy = CompositingStrategy.Offscreen }
    .drawWithContent {
      drawContent()
      drawRect(
        Brush.verticalGradient(0f to Color.Transparent, 0.06f to Color.Black, 0.82f to Color.Black, 1f to Color.Transparent),
        blendMode = BlendMode.DstIn,
      )
    }

/**
 * Seconds into the song, for the lyrics to follow frame by frame. The controller only estimates the
 * playhead between the player's updates and pulls it back a little when one arrives, which made a
 * lit word shrink back. So this clock runs on its own while the song plays and only eases toward the
 * player's reading, never backwards, as the website's smoothed clock does. A jump (a seek, a new
 * song) takes the player's word at once.
 */
@Composable
private fun rememberClock(player: PlayerViewModel, state: PlayerUiState): DoubleState {
  val clock = remember { mutableDoubleStateOf(player.positionMs() / 1000.0) }
  LaunchedEffect(state.jumps, state.nowPlaying?.mediaId) { clock.doubleValue = player.positionMs() / 1000.0 }
  LaunchedEffect(state.isPlaying) {
    if (!state.isPlaying) return@LaunchedEffect
    var last = withFrameMillis { it }
    while (true) {
      withFrameMillis { now ->
        val advanced = clock.doubleValue + (now - last) / 1000.0
        last = now
        val drift = player.positionMs() / 1000.0 - advanced
        clock.doubleValue =
          if (abs(drift) > CLOCK_JUMP) advanced + drift // a stall or a missed jump: no use easing
          else max(clock.doubleValue, advanced + drift * CLOCK_EASE)
      }
    }
  }
  return clock
}

/** A scroll the rows catch up with one after another, starting [WAVE_BEFORE] rows above [anchor]. */
private class Wave(val start: Long, val delta: Float, val anchor: Int)

private fun waveOffset(index: Int, waves: List<Wave>, now: Long): Float {
  var offset = 0f
  for (wave in waves) {
    val step = index - wave.anchor
    // Rows far from the line settle at once, as on the website.
    if (step < -WAVE_BEFORE - 4 || step > WAVE_AFTER + 4) continue
    val delay = (step + WAVE_BEFORE).coerceIn(0, WAVE_BEFORE + WAVE_AFTER) * WAVE_STAGGER_MS
    val progress = (((now - wave.start) / 1_000_000f - delay) / WAVE_MS).coerceIn(0f, 1f)
    val remaining = 1f - progress
    offset += wave.delta * remaining * remaining * remaining // power3.out
  }
  return offset
}

private enum class Follow {
  /** Straight there, as on opening. */
  Jump,
  /** Scroll in one step and let the rows catch up in a wave, as on a line change. */
  Wave,
  /** One smooth scroll, as when coming back from the listener's own scrolling. */
  Glide,
}

@Composable
private fun SyncedLyrics(
  lines: List<LyricLine>,
  state: PlayerUiState,
  player: PlayerViewModel,
  font: FontFamily,
  bleed: Dp,
  modifier: Modifier,
) {
  val clock = rememberClock(player, state)
  val active by remember(lines) { derivedStateOf { activeIndex(lines, clock.doubleValue) } }
  val vocals = remember(lines) { lines.map { splitBackground(it.words) } }
  // A plain scrolling column, not a lazy list: a song has a few dozen lines, and with all of them laid
  // out every line's place is known, so bringing one back is a single exact scroll, as on the website.
  val scroll = remember(lines) { ScrollState(0) }
  val tops = remember(lines) { IntArray(lines.size) }
  val heights = remember(lines) { IntArray(lines.size) }
  val waves = remember(lines) { mutableStateListOf<Wave>() }
  val frame = remember { mutableLongStateOf(0L) }
  var userScrolling by remember(lines) { mutableStateOf(false) }
  var followed by remember(lines) { mutableStateOf(false) }
  val playing by rememberUpdatedState(state.isPlaying)
  val scope = rememberCoroutineScope()
  // Pure white, as on the website: the cover's onSurface is a tinted grey that makes a lit line look dull.
  // Now Playing is always dark, so white always reads.
  val ink = Color.White
  // A mid-tone of the cover's colour, as the website's hsl(hue sat 52%) glow is: an ambient tint
  // under the line, where a light tone would read as the letters themselves glowing. Halfway
  // between the dark scheme's tone 40 (inversePrimary) and tone 80 (primary).
  val glow = lerp(MaterialTheme.colorScheme.inversePrimary, MaterialTheme.colorScheme.primary, 0.5f)

  // One blur per step of distance, made once: blurring a line or sharpening it only swaps the effect
  // on its layer, so the listener letting go doesn't rebuild every line at once.
  val density = LocalDensity.current
  val blurs = remember(density) {
    List(MAX_BLUR_DISTANCE) { step -> with(density) { (BlurPerLine * (step + 1)).toPx() }.let { BlurEffect(it, it, TileMode.Decal) } }
  }

  BoxWithConstraints(modifier.fillMaxSize()) {
    val viewport = constraints.maxHeight
    val topPadding = with(density) { 24.dp.roundToPx() }

    /** Brings the active line to the middle of the panel. */
    suspend fun follow(how: Follow) {
      val target = max(active, 0)
      val centered = (topPadding + tops[target] + heights[target] / 2 - viewport / 2).coerceIn(0, scroll.maxValue)
      val shift = centered - scroll.value
      when {
        abs(shift) < 1 -> Unit
        how == Follow.Glide -> scroll.animateScrollTo(centered, tween(800, easing = PowerThreeInOut))
        // A jump of more than a screen and a half would only blur past; the website skips it too.
        how == Follow.Jump || abs(shift) > viewport * 1.5f -> scroll.scrollTo(centered)
        else -> {
          val moved = scroll.scrollBy(shift.toFloat())
          // Same clock as the frames, and added before the next one draws, so no row jumps first.
          waves += Wave(System.nanoTime(), moved, target)
        }
      }
    }

    // The panel grows as the controls below step aside and shrinks as they come back; the line being
    // sung stays in the middle all the while.
    LaunchedEffect(viewport) {
      if (followed && !userScrolling) follow(Follow.Jump)
    }

    LaunchedEffect(active, lines) {
      if (userScrolling) return@LaunchedEffect
      if (!followed) withFrameNanos {} // the rows have to be laid out before they can be measured
      follow(if (followed) Follow.Wave else Follow.Jump)
      followed = true
    }

    // Runs the waves' clock only while one is moving.
    LaunchedEffect(waves) {
      while (true) {
        snapshotFlow { waves.isEmpty() }.first { !it }
        while (waves.isNotEmpty()) {
          withFrameNanos { now ->
            frame.longValue = now
            waves.removeAll { now - it.start > WAVE_SPAN_NS }
          }
        }
      }
    }

    // The listener's own scrolling holds off following; it resumes a moment after they let go, or
    // when playback starts again. While paused, the lyrics stay where they were left.
    LaunchedEffect(scroll) {
      var idle: Job? = null
      scroll.interactionSource.interactions.collect { interaction ->
        when (interaction) {
          is DragInteraction.Start -> {
            idle?.cancel()
            userScrolling = true
          }
          is DragInteraction.Stop,
          is DragInteraction.Cancel -> {
            idle?.cancel()
            idle = launch {
              delay(USER_SCROLL_IDLE_MS)
              userScrolling = false
              if (playing) follow(Follow.Glide)
            }
          }
        }
      }
    }
    LaunchedEffect(state.isPlaying) {
      if (state.isPlaying && userScrolling) {
        userScrolling = false
        follow(Follow.Glide)
      }
    }

    Column(
      Modifier.fillMaxSize()
        .fadeEdges()
        .verticalScroll(scroll)
        // Room below for the last line to reach the middle.
        .padding(start = bleed, top = 24.dp, end = bleed, bottom = maxHeight / 2)
    ) {
      lines.forEachIndexed { index, line ->
        val offset = { waveOffset(index, waves, frame.longValue) }
        Box(
          Modifier.onPlaced {
            tops[index] = it.positionInParent().y.roundToInt()
            heights[index] = it.size.height
          }
        ) {
          if (line.interlude) {
            InterludeRow(line, index == active, clock, ink, offset)
          } else {
            LyricRow(
              line = line,
              vocals = vocals[index],
              active = index == active,
              // Sharp while the listener scrolls, so they can read where they're going. Read as the
              // layer draws, so a change redraws the lines without recomposing them.
              blur = {
                val distance = if (active < 0) index + 1 else abs(index - active)
                if (distance == 0 || userScrolling) null else blurs[min(distance, MAX_BLUR_DISTANCE) - 1]
              },
              clock = clock,
              style = lyricStyle(font),
              ink = ink,
              glow = glow,
              waveOffset = offset,
              onPick = {
                userScrolling = false
                player.seekTo((line.time * 1000).toLong())
                // A line already active doesn't change, so nothing else would bring it back.
                if (index == active) scope.launch { follow(Follow.Glide) }
              },
            )
          }
        }
      }
    }
  }
}

@Composable
private fun LyricRow(
  line: LyricLine,
  vocals: Vocals,
  active: Boolean,
  blur: () -> RenderEffect?,
  clock: DoubleState,
  style: TextStyle,
  ink: Color,
  glow: Color,
  waveOffset: () -> Float,
  onPick: () -> Unit,
) {
  // The line coming in overshoots a touch, like the website's back.out ease; the one leaving settles.
  val scale by animateFloatAsState(
    if (active) 1f else 0.95f,
    if (active) spring(dampingRatio = 0.55f, stiffness = 260f) else tween(500),
    label = "line scale",
  )
  // The line's colour eases in and out over .35s, as the website's transition does. A line moving on
  // starts from the lit white, so words its fill hadn't reached yet light up with it before it dims,
  // rather than dropping out mid-fill when the next line starts early.
  val color by animateColorAsState(if (active) ink else ink.copy(alpha = 0.3f), tween(350), label = "line colour")
  Column(
    Modifier.fillMaxWidth()
      .graphicsLayer { translationY = waveOffset() }
      .clickable(interactionSource = null, indication = null, onClick = onPick)
      .padding(vertical = 12.dp)
      .graphicsLayer {
        scaleX = scale
        scaleY = scale
        transformOrigin = TransformOrigin(0f, 0.5f)
        renderEffect = blur()
      }
  ) {
    if (vocals.lead.isEmpty()) {
      val text = line.text.ifEmpty { "♪" }
      Box {
        // An untimed line glows evenly while it's sung: a blurred copy of it underneath.
        if (active) Text(text, style = style, color = glow.copy(alpha = GLOW_ALPHA), modifier = Modifier.blur(LineGlowBlur, BlurredEdgeTreatment.Unbounded))
        Text(text, style = style, color = color)
      }
    } else {
      TimedText(vocals.lead, active, clock, style, ink, glow, restColor = color)
      // Background vocals take a smaller row of their own, only while their line is sung.
      AnimatedVisibility(active && vocals.background.isNotEmpty(), enter = fadeIn() + expandVertically(), exit = fadeOut() + shrinkVertically()) {
        TimedText(
          vocals.background,
          active = true,
          clock = clock,
          style = style.copy(fontSize = style.fontSize * 0.62f),
          ink = ink,
          glow = glow,
          restColor = color,
          modifier = Modifier.padding(top = 4.dp).graphicsLayer { alpha = 0.8f },
        )
      }
    }
  }
}

/** Each word's characters in the row's text, leaving out the space after it. */
private fun timedText(words: List<LyricWord>): Pair<String, List<IntRange>> {
  val text = StringBuilder()
  val ranges = words.map { word ->
    val start = text.length
    text.append(word.text)
    start until start + word.text.trimEnd().length
  }
  return text.toString() to ranges
}

/** Where a run of characters sits, one rect per line it wraps onto. */
private fun segments(layout: TextLayoutResult, range: IntRange): List<Rect> {
  if (range.isEmpty()) return emptyList()
  return (layout.getLineForOffset(range.first)..layout.getLineForOffset(range.last)).map { line ->
    val lineEnd = layout.getLineEnd(line, visibleEnd = true)
    val start = max(range.first, layout.getLineStart(line))
    val left = layout.getHorizontalPosition(start, usePrimaryDirection = true)
    val right = if (range.last + 1 >= lineEnd) layout.getLineRight(line) else layout.getHorizontalPosition(range.last + 1, usePrimaryDirection = true)
    Rect(min(left, right), layout.getLineTop(line), max(left, right), layout.getLineBottom(line))
  }
}

/** How far a word rises as it's sung, as a share of its height: the website's yPercent -6. */
private const val WORD_LIFT = 0.06f
/** How much a held note swells at its height. */
private const val HELD_SWELL = 0.06f
/** The white halo of a held note at its height, as the website's .75. */
private const val HALO_ALPHA = 0.75f
private val PowerTwoOut = Easing { 1f - (1f - it) * (1f - it) }
/** GSAP's power3.inOut, for the glide back to the line being sung. */
private val PowerThreeInOut = CubicBezierEasing(0.65f, 0f, 0.35f, 1f)

/** How far a word has risen, and for a held note how far it has swollen and lit its halo; each 0 to 1. */
private class WordMotion(val lift: Float, val swell: Float) {
  fun scaled(by: Float) = WordMotion(lift * by, swell * by)

  companion object {
    val Rest = WordMotion(0f, 0f)
  }
}

/**
 * The website's word timeline. A word rises once it starts, across its length but at least 0.4 s.
 * A held note (a second or more, on a word of up to ten characters) also swells and lights a halo
 * over the first 55% of it, then eases back down through the rest and 0.3 s more.
 */
private fun LyricWord.motion(time: Double): WordMotion {
  val elapsed = (time - this.time).toFloat()
  if (elapsed <= 0f) return WordMotion.Rest
  val duration = max(0.05, end - this.time).toFloat()
  val lift = PowerTwoOut.transform((elapsed / max(0.4f, duration)).coerceAtMost(1f))
  if (duration < 1f || text.trim().length > 10) return WordMotion(lift, 0f)
  val peak = duration * 0.55f
  val swell =
    if (elapsed < peak) sin(elapsed / peak * PI.toFloat() / 2) // sine.out
    else (1f + cos(((elapsed - peak) / (duration - peak + 0.3f)).coerceAtMost(1f) * PI.toFloat())) / 2 // sine.inOut, back down
  return WordMotion(lift, swell)
}

/**
 * Draws [block] where the word has moved to: up by its lift, and swollen about a point 80% down it,
 * as the website's transform-origin of 50% 80% does.
 */
private inline fun DrawScope.moving(rect: Rect, motion: WordMotion, crossinline block: DrawScope.() -> Unit) {
  if (motion.lift == 0f && motion.swell == 0f) return block()
  val scale = 1f + HELD_SWELL * motion.swell
  withTransform(
    {
      translate(top = -WORD_LIFT * motion.lift * rect.height)
      scale(scale, scale, pivot = Offset(rect.center.x, rect.top + rect.height * 0.8f))
    }
  ) {
    block()
  }
}

/**
 * Draws one word on its own, so it can move on its own: in [base], lit from the left as it's sung,
 * with the lit edge soft across 30% of the word and the word fully lit when it ends, as the
 * website's gradient does.
 */
private fun DrawScope.drawWord(layout: TextLayoutResult, rects: List<Rect>, progress: Float, motion: WordMotion, ink: Color, base: Color) {
  val total = rects.sumOf { it.width.toDouble() }.toFloat()
  val edge = total * progress * 1.3f
  val solid = edge - total * 0.3f
  var before = 0f
  for (rect in rects) {
    val lit = (edge - before).coerceIn(0f, rect.width)
    val from = before
    moving(rect, motion) {
      clipRect(rect.left, rect.top, rect.right, rect.bottom) {
        drawText(layout, color = base.copy(alpha = 1f), alpha = base.alpha, shadow = Shadow.None)
      }
      if (lit > 0f) {
        clipRect(rect.left, rect.top, rect.left + lit, rect.bottom) {
          drawText(
            layout,
            brush = Brush.horizontalGradient(listOf(ink, Color.Transparent), startX = rect.left + solid - from, endX = rect.left + edge - from),
            // Left unset, the alpha would be the dim unsung text's, and the lit words would come out grey.
            alpha = 1f,
            shadow = Shadow.None,
          )
        }
      }
    }
    before += rect.width
  }
}

private fun LyricWord.progress(time: Double) = ((time - this.time) / max(0.05, end - this.time)).coerceIn(0.0, 1.0).toFloat()

@Composable
private fun TimedText(
  words: List<LyricWord>,
  active: Boolean,
  clock: DoubleState,
  style: TextStyle,
  ink: Color,
  glow: Color,
  /** The words' colour while their line isn't the one being sung. */
  restColor: Color,
  modifier: Modifier = Modifier,
) {
  val (text, ranges) = remember(words) { timedText(words) }
  var layout by remember { mutableStateOf<TextLayoutResult?>(null) }
  val rects = remember(layout, ranges) { layout?.let { laid -> ranges.map { segments(laid, it) } } }
  // When the line moves on, its words settle back over half a second from wherever they had got to.
  val settle = remember { Animatable(0f) }
  var settledFrom by remember { mutableDoubleStateOf(0.0) }
  LaunchedEffect(active) {
    if (active) {
      settle.snapTo(1f)
    } else if (settle.value > 0f) {
      settledFrom = clock.doubleValue
      settle.animateTo(0f, tween(500, easing = PowerTwoOut))
    }
  }
  Box(modifier) {
    if (active) {
      // The glow is a blurred copy of the words underneath, moving with them: faint under the ones
      // still to come and full under each as it's sung, like the website's glow copy that follows
      // the fill. A held note adds a white halo.
      Spacer(
        Modifier.matchParentSize()
          .blur(WordGlowBlur, BlurredEdgeTreatment.Unbounded)
          .drawBehind {
            val laid = layout ?: return@drawBehind
            val wordRects = rects ?: return@drawBehind
            val time = clock.doubleValue
            words.forEachIndexed { index, word ->
              val strength = 0.34f + 0.66f * word.progress(time)
              val motion = word.motion(time)
              for (rect in wordRects[index]) {
                moving(rect, motion) {
                  clipRect(rect.left, rect.top, rect.right, rect.bottom) {
                    drawText(laid, color = glow, alpha = GLOW_ALPHA * strength, shadow = Shadow.None)
                    if (motion.swell > 0f) drawText(laid, color = Color.White, alpha = HALO_ALPHA * motion.swell, shadow = Shadow.None)
                  }
                }
              }
            }
          }
      )
    }
    Text(
      text,
      style = style,
      color = if (active) ink.copy(alpha = 0.34f) else restColor,
      onTextLayout = { layout = it },
      // Drawn word by word while sung, and while its words settle after; otherwise as plain text.
      modifier =
        Modifier.drawWithContent {
          val laid = layout
          val wordRects = rects
          val settling = settle.value
          if (laid == null || wordRects == null || (!active && settling == 0f)) {
            drawContent()
            return@drawWithContent
          }
          val time = if (active) clock.doubleValue else settledFrom
          words.forEachIndexed { index, word ->
            if (active) {
              drawWord(laid, wordRects[index], word.progress(time), word.motion(time), ink, base = ink.copy(alpha = 0.34f))
            } else {
              drawWord(laid, wordRects[index], 0f, word.motion(time).scaled(settling), ink, base = restColor)
            }
          }
        },
    )
  }
}

/**
 * • • • over an instrumental gap, in the list only while it lasts. The dots light up one by one
 * across the gap, then shrink away just before the next line.
 */
@Composable
private fun InterludeRow(line: LyricLine, active: Boolean, clock: DoubleState, ink: Color, waveOffset: () -> Float) {
  AnimatedVisibility(
    active,
    enter = fadeIn() + expandVertically(),
    exit = fadeOut() + shrinkVertically(),
    modifier = Modifier.graphicsLayer { translationY = waveOffset() },
  ) {
    val breath by rememberInfiniteTransition(label = "interlude").animateFloat(
      1f,
      1.12f,
      infiniteRepeatable(tween(1200), RepeatMode.Reverse),
      label = "breath",
    )
    Row(
      Modifier.padding(vertical = 12.dp)
        .height(39.dp)
        .graphicsLayer {
          scaleX = breath
          scaleY = breath
          transformOrigin = TransformOrigin(0f, 0.5f)
        },
      horizontalArrangement = Arrangement.spacedBy(9.dp),
      verticalAlignment = Alignment.CenterVertically,
    ) {
      repeat(3) { dot ->
        Box(
          Modifier.size(9.dp)
            .graphicsLayer {
              val time = clock.doubleValue
              val end = line.end ?: line.time
              val outAt = end - LINE_LOOKAHEAD - INTERLUDE_OUT
              val progress = ((time - line.time) / max(0.1, outAt - line.time)).coerceIn(0.0, 1.0)
              val fade = (1 - (time - outAt) / INTERLUDE_OUT).coerceIn(0.0, 1.0).toFloat()
              alpha = 0.3f + 0.7f * (progress * 3 - dot).coerceIn(0.0, 1.0).toFloat()
              scaleX = fade
              scaleY = fade
            }
            .background(ink, CircleShape)
        )
      }
    }
  }
}

@Composable
private fun PlainLyrics(lines: List<String>, font: FontFamily, bleed: Dp, modifier: Modifier) {
  val ink = Color.White
  LazyColumn(
    modifier.fillMaxSize().fadeEdges(),
    state = rememberLazyListState(),
    contentPadding = PaddingValues(horizontal = bleed, vertical = 24.dp),
  ) {
    itemsIndexed(lines) { _, line ->
      Text(
        line.ifEmpty { " " },
        style = lyricStyle(font).copy(fontSize = 22.sp),
        color = ink.copy(alpha = 0.8f),
        modifier = Modifier.padding(vertical = 4.dp),
      )
    }
  }
}

@Composable
private fun LyricsSkeleton(modifier: Modifier) {
  val shimmer by rememberInfiniteTransition(label = "skeleton").animateFloat(
    0.06f,
    0.12f,
    infiniteRepeatable(tween(1400), RepeatMode.Reverse),
    label = "shimmer",
  )
  val ink = MaterialTheme.colorScheme.onSurface
  Column(modifier.fillMaxSize().padding(top = 36.dp), verticalArrangement = Arrangement.spacedBy(22.dp)) {
    for (width in listOf(1f, 0.72f, 0.88f, 0.56f)) {
      Box(Modifier.fillMaxWidth(width).height(34.dp).clip(RoundedCornerShape(6.dp)).background(ink.copy(alpha = shimmer)))
    }
  }
}

@Composable
private fun LyricsMessage(title: String, detail: String?, onRetry: (() -> Unit)?, modifier: Modifier) {
  Column(
    modifier.fillMaxSize(),
    verticalArrangement = Arrangement.Center,
    horizontalAlignment = Alignment.CenterHorizontally,
  ) {
    Icon(painterResource(R.drawable.ic_lyrics), contentDescription = null, tint = MaterialTheme.colorScheme.onSurfaceVariant, modifier = Modifier.size(28.dp))
    Text(title, style = MaterialTheme.typography.titleMedium, color = MaterialTheme.colorScheme.onSurfaceVariant, modifier = Modifier.padding(top = 16.dp))
    detail?.let {
      Text(it, style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant, modifier = Modifier.padding(top = 4.dp))
    }
    onRetry?.let { TextButton(onClick = it, modifier = Modifier.padding(top = 8.dp)) { Text("重試") } }
  }
}
