package com.ascooo.android.music.ui.theme

import androidx.compose.material3.MaterialExpressiveTheme
import androidx.compose.material3.MotionScheme
import androidx.compose.material3.dynamicDarkColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.ui.platform.LocalContext

/**
 * Dark only, like the website. [dynamicColor] swaps the brand palette for Material You colours
 * taken from the wallpaper (Android 12+, which is the app's minimum).
 */
@Composable
fun AscoooTheme(dynamicColor: Boolean = false, content: @Composable () -> Unit) {
  val colorScheme = if (dynamicColor) dynamicDarkColorScheme(LocalContext.current) else BrandDarkColors
  MaterialExpressiveTheme(
    colorScheme = colorScheme,
    motionScheme = MotionScheme.expressive(),
    typography = AppTypography,
    content = content,
  )
}
