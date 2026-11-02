package com.ascooo.android.music.ui

import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.core.Animatable
import androidx.compose.animation.fadeIn
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.offset
import androidx.compose.material3.LoadingIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.drawBehind
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.drawscope.clipRect
import androidx.compose.ui.graphics.drawscope.translate
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.res.colorResource
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.dp
import com.ascooo.android.music.R
import kotlinx.coroutines.delay

// Measured from the mark's centre, at 0.41dp per unit of brand_logo's viewport: the scale
// splash_logo's mark comes out at, so brand_logo drawn here puts "usic" exactly beside it.
private val MarkBox = 288.dp // the size the system splash draws its 108dp icon canvas at
private val LogoLeft = (-49.77).dp
private val LogoTop = (-50.50).dp
private val LogoWidth = 230.63.dp
private val LogoHeight = 98.40.dp
private val WordmarkLeft = 48.33.dp // just left of the "u", clear of the mark
private val WordmarkSlide = 123.95.dp // from there to the end of the "c"
private val SettledShift = (-64.11).dp // moves the mark left until the whole logo is centred

/**
 * Covers the app while it starts. It opens on exactly what the system splash shows, the bare mark
 * centred on the brand black, then slides the mark left as "usic" comes out from behind it to spell
 * the full logo. [played] skips straight to the full logo, as after a rotation.
 */
@Composable
fun LaunchIntro(played: Boolean, loading: Boolean, onPlayed: () -> Unit, modifier: Modifier = Modifier) {
  val mark = painterResource(R.drawable.splash_logo)
  val logo = painterResource(R.drawable.brand_logo)
  val progress = remember { Animatable(if (played) 1f else 0f) }
  val slide = MaterialTheme.motionScheme.slowSpatialSpec<Float>()
  var slow by remember { mutableStateOf(false) }

  LaunchedEffect(Unit) {
    if (progress.value < 1f) {
      delay(150) // a beat on the mark the splash was showing before it moves
      progress.animateTo(1f, slide)
      delay(300) // and one on the finished logo before the app takes over
    }
    onPlayed()
    delay(800)
    slow = true
  }

  Box(
    modifier
      .fillMaxSize()
      // The splash's colour rather than the theme's, which Material You would change.
      .background(colorResource(R.color.brand_background))
      .pointerInput(Unit) {} // keep taps off the screens loading underneath
      .semantics { contentDescription = "Ascooo Music" }
  ) {
    Spacer(
      Modifier.fillMaxSize().drawBehind {
        val p = progress.value
        val markX = size.width / 2 + SettledShift.toPx() * p
        val markY = size.height / 2
        val box = MarkBox.toPx()
        translate(markX - box / 2, markY - box / 2) { with(mark) { draw(Size(box, box)) } }
        // The full logo, cut down to its wordmark by a clip at the wordmark's final left edge, so
        // "usic" seems to slide out from behind the mark.
        val tucked = WordmarkSlide.toPx() * (1 - p)
        clipRect(left = markX + WordmarkLeft.toPx()) {
          translate(markX + LogoLeft.toPx() - tucked, markY + LogoTop.toPx()) {
            with(logo) { draw(Size(LogoWidth.toPx(), LogoHeight.toPx())) }
          }
        }
      }
    )
    // Only when restoring the session is slow, so a quick start never flashes it.
    AnimatedVisibility(
      loading && slow,
      Modifier.align(Alignment.Center).offset(y = 96.dp),
      enter = fadeIn(MaterialTheme.motionScheme.defaultEffectsSpec()),
    ) {
      LoadingIndicator()
    }
  }
}
