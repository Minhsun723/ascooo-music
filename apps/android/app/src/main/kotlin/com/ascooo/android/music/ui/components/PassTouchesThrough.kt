package com.ascooo.android.music.ui.components

import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.drawWithContent
import androidx.compose.ui.graphics.drawscope.translate
import androidx.compose.ui.layout.layout

/**
 * While [enabled], touches go through this content to whatever lies underneath, though it looks the
 * same. For a page on its way out that is still drawn on top: Navigation 3 keeps a popped page above
 * the one coming back until the transition ends, long after it has faded. Compose can't leave a
 * subtree out of hit testing, so the content is laid out off to the side, out of reach, and drawn
 * back where it was.
 */
fun Modifier.passTouchesThrough(enabled: Boolean): Modifier =
  drawWithContent { if (enabled) translate(left = -size.width * ASIDE) { this@drawWithContent.drawContent() } else drawContent() }
    .layout { measurable, constraints ->
      val placeable = measurable.measure(constraints)
      layout(placeable.width, placeable.height) { placeable.place(if (enabled) placeable.width * ASIDE else 0, 0) }
    }

/** In widths; two keeps even a small button's widened touch target clear of the screen. */
private const val ASIDE = 2
