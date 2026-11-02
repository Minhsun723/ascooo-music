package com.ascooo.android.music.ui.theme

import android.content.Context
import android.graphics.Bitmap
import android.util.LruCache
import androidx.compose.animation.animateColorAsState
import androidx.compose.material3.ColorScheme
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.darkColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.ui.graphics.Color
import coil3.imageLoader
import coil3.request.ImageRequest
import coil3.request.SuccessResult
import coil3.request.allowHardware
import coil3.toBitmap
import com.materialkolor.hct.Hct
import com.materialkolor.palettes.TonalPalette
import com.materialkolor.quantize.QuantizerCelebi
import com.materialkolor.scheme.DynamicScheme
import com.materialkolor.scheme.SchemeContent
import com.materialkolor.score.Score
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext

/** Now Playing's colours: a Material scheme for the controls and text, and a deep [backdrop] tone. */
class CoverColors(val scheme: ColorScheme, val backdrop: Color)

/** Covers already worked out, by URL. A cover with no usable colour is kept as a null entry. */
private val cache = LruCache<String, Entry>(64)

private class Entry(val colors: CoverColors?)

/** What [coverColors] already knows for [url], without loading anything. */
fun cachedCoverColors(url: String): CoverColors? = cache[url]?.colors

/**
 * Seeds Now Playing's colours from a cover the way Android seeds Material You from the wallpaper:
 * the pixels are quantized and scored, and the winner seeds a content scheme, which keeps that colour
 * recognisable instead of easing it into a tidier tone. Black-and-white or grey covers have no
 * colour to give and return null, so the page keeps the app's own palette.
 */
suspend fun coverColors(context: Context, url: String): CoverColors? {
  cache[url]?.let { return it.colors }
  // The same URL as the artwork on the page, so it comes from Coil's disk cache, only decoded small.
  val request = ImageRequest.Builder(context).data(url).size(128).allowHardware(false).build()
  val image = (context.imageLoader.execute(request) as? SuccessResult)?.image ?: return null
  val colors = withContext(Dispatchers.Default) { seed(image.toBitmap())?.let(::coverColorsFor) }
  cache.put(url, Entry(colors))
  return colors
}

private fun seed(bitmap: Bitmap): Int? {
  val pixels = IntArray(bitmap.width * bitmap.height)
  bitmap.getPixels(pixels, 0, bitmap.width, 0, 0, bitmap.width, bitmap.height)
  return Score.score(QuantizerCelebi.quantize(pixels, 128), desired = 1, fallbackColorArgb = null).firstOrNull()
}

private fun coverColorsFor(seed: Int): CoverColors {
  val scheme = SchemeContent(Hct.fromInt(seed), isDark = true, contrastLevel = 0.0)
  // The website's Now Playing sits on a deep tone of the cover's hue. Tone 25 with the chroma capped
  // keeps the colour without outshining the cover, which a saturated red otherwise does.
  val palette = scheme.primaryPalette
  val backdrop = TonalPalette.fromHueAndChroma(palette.hue, palette.chroma.coerceAtMost(40.0)).tone(25)
  return CoverColors(scheme.toColorScheme(), Color(backdrop))
}

private fun DynamicScheme.toColorScheme(): ColorScheme =
  darkColorScheme(
    primary = Color(primary),
    onPrimary = Color(onPrimary),
    primaryContainer = Color(primaryContainer),
    onPrimaryContainer = Color(onPrimaryContainer),
    inversePrimary = Color(inversePrimary),
    secondary = Color(secondary),
    onSecondary = Color(onSecondary),
    secondaryContainer = Color(secondaryContainer),
    onSecondaryContainer = Color(onSecondaryContainer),
    tertiary = Color(tertiary),
    onTertiary = Color(onTertiary),
    tertiaryContainer = Color(tertiaryContainer),
    onTertiaryContainer = Color(onTertiaryContainer),
    background = Color(background),
    onBackground = Color(onBackground),
    surface = Color(surface),
    onSurface = Color(onSurface),
    surfaceVariant = Color(surfaceVariant),
    onSurfaceVariant = Color(onSurfaceVariant),
    surfaceTint = Color(surfaceTint),
    inverseSurface = Color(inverseSurface),
    inverseOnSurface = Color(inverseOnSurface),
    error = Color(error),
    onError = Color(onError),
    errorContainer = Color(errorContainer),
    onErrorContainer = Color(onErrorContainer),
    outline = Color(outline),
    outlineVariant = Color(outlineVariant),
    scrim = Color(scrim),
    surfaceBright = Color(surfaceBright),
    surfaceContainer = Color(surfaceContainer),
    surfaceContainerHigh = Color(surfaceContainerHigh),
    surfaceContainerHighest = Color(surfaceContainerHighest),
    surfaceContainerLow = Color(surfaceContainerLow),
    surfaceContainerLowest = Color(surfaceContainerLowest),
    surfaceDim = Color(surfaceDim),
    primaryFixed = Color(primaryFixed),
    primaryFixedDim = Color(primaryFixedDim),
    onPrimaryFixed = Color(onPrimaryFixed),
    onPrimaryFixedVariant = Color(onPrimaryFixedVariant),
    secondaryFixed = Color(secondaryFixed),
    secondaryFixedDim = Color(secondaryFixedDim),
    onSecondaryFixed = Color(onSecondaryFixed),
    onSecondaryFixedVariant = Color(onSecondaryFixedVariant),
    tertiaryFixed = Color(tertiaryFixed),
    tertiaryFixedDim = Color(tertiaryFixedDim),
    onTertiaryFixed = Color(onTertiaryFixed),
    onTertiaryFixedVariant = Color(onTertiaryFixedVariant),
  )

/**
 * Eases from one cover's colours to the next. Only the roles Now Playing paints with are animated;
 * the rest switch at once, as nothing on the page shows them.
 */
@Composable
fun animateCoverColors(target: CoverColors): CoverColors {
  val spec = MaterialTheme.motionScheme.slowEffectsSpec<Color>()

  @Composable
  fun animate(color: Color) = animateColorAsState(color, spec, label = "cover colour").value

  val scheme = target.scheme
  return CoverColors(
    scheme.copy(
      primary = animate(scheme.primary),
      onPrimary = animate(scheme.onPrimary),
      secondaryContainer = animate(scheme.secondaryContainer),
      surface = animate(scheme.surface),
      onSurface = animate(scheme.onSurface),
      onSurfaceVariant = animate(scheme.onSurfaceVariant),
      surfaceContainerHigh = animate(scheme.surfaceContainerHigh),
      error = animate(scheme.error),
    ),
    animate(target.backdrop),
  )
}
