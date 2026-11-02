package com.ascooo.android.music.ui.lyrics

import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.googlefonts.Font
import androidx.compose.ui.text.googlefonts.GoogleFont
import com.ascooo.android.music.R
import com.ascooo.android.music.data.LyricsFont

/**
 * Fetched from Google Fonts through Play services the first time they're shown and shared with
 * other apps after that, rather than packed into the app: CJK fonts run to megabytes each. Until
 * one arrives, or where Play services is missing, the system font stands in.
 */
private val provider =
  GoogleFont.Provider(
    providerAuthority = "com.google.android.gms.fonts",
    providerPackage = "com.google.android.gms",
    certificates = R.array.com_google_android_gms_fonts_certs,
  )

private fun googleFont(name: String) = FontFamily(Font(GoogleFont(name), provider, FontWeight.Bold))

// Made once, so every screen shares one load of each font.
private val serif = googleFont("Noto Serif TC")
private val wenKai = googleFont("LXGW WenKai Mono TC")
private val decol = googleFont("Kaisei Decol")

/** The system font is already Noto Sans CJK, so Sans needs no download. */
val LyricsFont.fontFamily: FontFamily
  get() =
    when (this) {
      LyricsFont.Sans -> FontFamily.Default
      LyricsFont.Serif -> serif
      LyricsFont.WenKai -> wenKai
      LyricsFont.Decol -> decol
    }

/** The names the website's settings use. */
val LyricsFont.label: String
  get() =
    when (this) {
      LyricsFont.Sans -> "Noto Sans"
      LyricsFont.Serif -> "Noto Serif"
      LyricsFont.WenKai -> "LXGW WenKai Mono"
      LyricsFont.Decol -> "Kaisei Decol"
    }

const val LYRICS_FONT_SAMPLE = "歌詞預覽 うた Aa"
