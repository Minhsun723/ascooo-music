package com.ascooo.android.music.ui.player

import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.aspectRatio
import androidx.compose.foundation.layout.height
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.BlurredEdgeTreatment
import androidx.compose.ui.draw.blur
import androidx.compose.ui.layout.FirstBaseline
import androidx.compose.ui.layout.layout
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.role
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.dp
import com.ascooo.android.music.R
import com.ascooo.android.music.playback.AudioSource
import com.ascooo.android.music.ui.components.AAC51_ASPECT
import com.ascooo.android.music.ui.components.AAC51_BASELINE
import com.ascooo.android.music.ui.components.Aac51Logo
import kotlin.math.roundToInt

/**
 * The mark for the file playing, as the website's player shows it: Dolby Atmos for the Atmos mix, AAC
 * 5.1 for the copy made from it on a phone without the decoder.
 */
enum class Surround {
  DolbyAtmos,
  Aac51,
}

val NowPlaying.surround: Surround?
  get() =
    when {
      source == AudioSource.Aac51 -> Surround.Aac51
      atmos -> Surround.DolbyAtmos
      else -> null
    }

/**
 * [surround]'s mark in the cover's colour, glowing faintly: a blurred copy of it underneath, left free
 * to spill past its edges. Its first baseline is where the mark's letters or numerals stand, for a row
 * to stand it on the times' baseline.
 */
@Composable
fun SurroundMark(surround: Surround, modifier: Modifier = Modifier) {
  val color = MaterialTheme.colorScheme.primary
  val glow = Modifier.blur(GlowBlur, BlurredEdgeTreatment.Unbounded)
  when (surround) {
    Surround.DolbyAtmos -> {
      val logo = painterResource(R.drawable.dolby_atmos)
      Box(modifier.firstBaselineAt(DOLBY_ATMOS_BASELINE)) {
        Icon(logo, contentDescription = null, tint = color.copy(alpha = GLOW_ALPHA), modifier = Modifier.matchParentSize().then(glow))
        // Sized by its height; the drawable keeps its proportions.
        Icon(logo, contentDescription = "Dolby Atmos", tint = color, modifier = Modifier.height(DolbyAtmosHeight))
      }
    }
    Surround.Aac51 ->
      Box(modifier.firstBaselineAt(AAC51_BASELINE)) {
        // Solid, it gives off more light than the thin wordmark for the same glow; dimmer evens them out.
        Aac51Logo(color.copy(alpha = AAC51_GLOW_ALPHA), Modifier.matchParentSize().then(glow))
        Aac51Logo(
          color,
          Modifier.height(Aac51Height).aspectRatio(AAC51_ASPECT).semantics {
            contentDescription = "AAC 5.1"
            role = Role.Image
          },
        )
      }
  }
}

/** Gives the layout a first baseline [fraction] of the way down its height. */
private fun Modifier.firstBaselineAt(fraction: Float) = layout { measurable, constraints ->
  val placeable = measurable.measure(constraints)
  layout(placeable.width, placeable.height, mapOf(FirstBaseline to (placeable.height * fraction).roundToInt())) { placeable.place(0, 0) }
}

/** A little taller than the times' digits, as the wordmark's letters fill only part of its height. */
private val DolbyAtmosHeight = 12.dp

/** Where the wordmark's letters stand, as a share of its height: y 12.03 of R.drawable.dolby_atmos's 15.64. */
private const val DOLBY_ATMOS_BASELINE = 12.028f / 15.643f

/** The numerals then stand as tall as the wordmark's letters. */
private val Aac51Height = 13.dp

private val GlowBlur = 5.dp
private const val GLOW_ALPHA = 0.8f
private const val AAC51_GLOW_ALPHA = 0.5f
