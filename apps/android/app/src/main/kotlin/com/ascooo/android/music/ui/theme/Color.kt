package com.ascooo.android.music.ui.theme

import androidx.compose.material3.darkColorScheme
import androidx.compose.ui.graphics.Color

/**
 * The website's near-black palette (apps/web/src/styles.css) laid onto Material's colour roles.
 * Like the site's primary buttons, primary is white on black; the brand blue is tertiary.
 */
internal val BrandDarkColors =
  darkColorScheme(
    primary = Color(0xFFF8F8F8),
    onPrimary = Color(0xFF080808),
    primaryContainer = Color(0xFF2A2A30),
    onPrimaryContainer = Color(0xFFF8F8F8),
    inversePrimary = Color(0xFF080808),
    secondary = Color(0xFFB9B9C1),
    onSecondary = Color(0xFF080808),
    secondaryContainer = Color(0xFF2A2A30),
    onSecondaryContainer = Color(0xFFF8F8F8),
    tertiary = Color(0xFF28A9FF),
    onTertiary = Color(0xFF00213A),
    tertiaryContainer = Color(0xFF00497A),
    onTertiaryContainer = Color(0xFFD0E8FF),
    background = Color(0xFF080808),
    onBackground = Color(0xFFF8F8F8),
    surface = Color(0xFF080808),
    onSurface = Color(0xFFF8F8F8),
    surfaceVariant = Color(0xFF1D1D21),
    onSurfaceVariant = Color(0xFFB9B9C1),
    surfaceTint = Color(0xFFF8F8F8),
    inverseSurface = Color(0xFFF8F8F8),
    inverseOnSurface = Color(0xFF151518),
    outline = Color(0xFF85858F),
    outlineVariant = Color(0xFF2A2A30),
    surfaceDim = Color(0xFF080808),
    surfaceBright = Color(0xFF2A2A30),
    surfaceContainerLowest = Color(0xFF050505),
    surfaceContainerLow = Color(0xFF0F0F11),
    surfaceContainer = Color(0xFF151518),
    surfaceContainerHigh = Color(0xFF1D1D21),
    surfaceContainerHighest = Color(0xFF24242A),
  )
