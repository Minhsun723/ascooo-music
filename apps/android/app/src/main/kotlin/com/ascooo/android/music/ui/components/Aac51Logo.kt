package com.ascooo.android.music.ui.components

import androidx.compose.foundation.Canvas
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.CornerRadius
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.BlendMode
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.CompositingStrategy
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.StrokeJoin
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.graphics.drawscope.scale
import androidx.compose.ui.graphics.drawscope.translate
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.graphics.vector.PathParser

/** The AAC 5.1 mark's width to its height, from its 24 × 16 viewBox. */
const val AAC51_ASPECT = 24f / 16f

/**
 * Where the numerals stand, as a share of the mark's height: their strokes end 12.2 down at a 0.95
 * scale, half a stroke more below, in the viewBox's 16.
 */
const val AAC51_BASELINE = (1.26f + 0.95f * (12.2f + 0.95f)) / 16f

/**
 * The website's AAC 5.1 mark, drawn in its 24 × 16 viewBox: a solid badge with the numerals cut out of
 * it. They're cleared from a layer of its own, so whatever is behind shows through them. Fills
 * [modifier]'s size; give it [AAC51_ASPECT].
 */
@Composable
fun Aac51Logo(color: Color, modifier: Modifier = Modifier) {
  Canvas(modifier.graphicsLayer { compositingStrategy = CompositingStrategy.Offscreen }) {
    val unit = size.height / 16f
    scale(unit, unit, pivot = Offset.Zero) {
      drawRoundRect(color, size = Size(24f, 16f), cornerRadius = CornerRadius(3f))
      translate(3.12f, 1.26f) {
        scale(0.95f, 0.95f, pivot = Offset.Zero) {
          drawPath(Five, Color.Black, style = NumeralStroke, blendMode = BlendMode.Clear)
          drawCircle(Color.Black, radius = 1.15f, center = Offset(11.2f, 11.2f), blendMode = BlendMode.Clear)
          drawPath(One, Color.Black, style = NumeralStroke, blendMode = BlendMode.Clear)
        }
      }
    }
  }
}

private val Five =
  PathParser().parsePathString("M8 2.2H3l-.5 4.4c.8-.6 1.7-.8 2.6-.8 2 0 3.3 1.4 3.3 3.2 0 1.9-1.4 3.2-3.4 3.2-1.3 0-2.3-.6-2.9-1.5").toPath()
private val One = PathParser().parsePathString("M14 4.2L16.6 2V12.2").toPath()
private val NumeralStroke = Stroke(width = 1.9f, cap = StrokeCap.Round, join = StrokeJoin.Round)
