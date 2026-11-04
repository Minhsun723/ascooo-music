package com.ascooo.android.music.ui.lyrics

import android.content.Context
import android.graphics.Typeface
import android.graphics.fonts.Font
import androidx.compose.ui.text.font.AndroidFont
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontLoadingStrategy
import androidx.compose.ui.text.font.FontStyle
import androidx.compose.ui.text.font.FontVariation
import androidx.compose.ui.text.font.FontWeight
import androidx.core.provider.FontRequest
import androidx.core.provider.FontsContractCompat
import com.ascooo.android.music.R
import com.ascooo.android.music.data.LyricsFont
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.async
import kotlinx.coroutines.awaitAll
import kotlinx.coroutines.coroutineScope
import kotlinx.coroutines.withContext
import android.graphics.fonts.FontFamily as PlatformFontFamily
import android.graphics.fonts.FontStyle as PlatformFontStyle

/**
 * A lyric font followed by the fonts that fill in the characters it lacks, as in the website's
 * `--font-*` stacks, ending in a system family. Compose's own FontFamily only moves on to its next
 * font when one fails to load, never per character, so a missing glyph would drop straight to the
 * system's sans; the chain is built as one platform Typeface instead.
 *
 * The fonts are fetched from Google Fonts through Play services the first time they're shown and
 * shared with other apps after that, rather than packed into the app: CJK fonts run to megabytes
 * each. Until they arrive, or where Play services is missing, the system font stands in.
 */
private class ChainFont(private val chain: List<Pair<String, Int>>, private val systemFallback: String) :
  AndroidFont(FontLoadingStrategy.Async, ChainLoader, FontVariation.Settings()) {
  override val weight = FontWeight.Bold
  override val style = FontStyle.Normal

  @Volatile private var loaded: Typeface? = null

  suspend fun load(context: Context): Typeface? {
    loaded?.let { return it }
    val families = coroutineScope { chain.map { (name, weight) -> async { fetch(context, name, weight) } }.awaitAll() }
    // A fallback that fails is skipped, but without the font itself there is nothing to chain.
    val builder = Typeface.CustomFallbackBuilder(families.first() ?: return null)
    families.drop(1).filterNotNull().forEach(builder::addCustomFallback)
    return builder
      .setSystemFallback(systemFallback)
      .setStyle(PlatformFontStyle(PlatformFontStyle.FONT_WEIGHT_BOLD, PlatformFontStyle.FONT_SLANT_UPRIGHT))
      .build()
      .also { loaded = it }
  }
}

private object ChainLoader : AndroidFont.TypefaceLoader {
  override fun loadBlocking(context: Context, font: AndroidFont): Typeface = error("Lyric fonts only load asynchronously")

  override suspend fun awaitLoad(context: Context, font: AndroidFont): Typeface? = (font as ChainFont).load(context)
}

/** Asks Play services for one Google Font, which blocks while it downloads, and maps its file. */
private suspend fun fetch(context: Context, name: String, weight: Int): PlatformFontFamily? =
  withContext(Dispatchers.IO) {
    runCatching {
      // The name goes in as written, spaces and all, as Compose's own GoogleFont sends it.
      val query = "name=$name&weight=$weight&italic=0&besteffort=true"
      val request = FontRequest("com.google.android.gms.fonts", "com.google.android.gms", query, R.array.com_google_android_gms_fonts_certs)
      val result = FontsContractCompat.fetchFonts(context, null, request)
      if (result.statusCode != FontsContractCompat.FontFamilyResult.STATUS_OK) return@runCatching null
      val info = result.fonts.firstOrNull { it.resultCode == FontsContractCompat.Columns.RESULT_CODE_OK } ?: return@runCatching null
      val font =
        context.contentResolver.openFileDescriptor(info.uri, "r")?.use { file ->
          Font.Builder(file).setWeight(info.weight).setTtcIndex(info.ttcIndex).build()
        } ?: return@runCatching null
      PlatformFontFamily.Builder(font).build()
    }.getOrNull()
  }

// Made once, so every screen shares one load of each chain. Where the website lists Noto's JP, SC
// and KR cuts as well, the system fallback brings them: Android ships Noto Sans and Serif CJK.
private val serif = FontFamily(ChainFont(listOf("Noto Serif TC" to 700), systemFallback = "serif"))
private val wenKai = FontFamily(ChainFont(listOf("LXGW WenKai Mono TC" to 700, "Klee One" to 600), systemFallback = "sans-serif"))
private val decol = FontFamily(ChainFont(listOf("Kaisei Decol" to 700, "Noto Serif TC" to 700), systemFallback = "serif"))

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
