package com.ascooo.android.music.ui.components

import androidx.annotation.DrawableRes
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.aspectRatio
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.layout.width
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.FilledTonalButton
import androidx.compose.material3.Icon
import androidx.compose.material3.LocalContentColor
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Shape
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.role
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.LinkAnnotation
import androidx.compose.ui.text.SpanStyle
import androidx.compose.ui.text.TextLinkStyles
import androidx.compose.ui.text.buildAnnotatedString
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.withLink
import androidx.compose.ui.unit.dp
import com.ascooo.android.music.R
import com.ascooo.android.music.data.ArtistCredit
import com.ascooo.android.music.data.Track

/**
 * The top of an album, artist or playlist page: the cover, the title, an optional [subtitle] that
 * can link elsewhere (or, for more than one of [artists], each name linking to its own page, as on
 * the website), a [meta] line, the Dolby Atmos logo where [dolbyAtmos] and the AAC 5.1 one
 * where [aac51], [badges] and the play and shuffle buttons for [tracks]. Both marks show for what the
 * album has, whichever of them this device plays; Now Playing shows only the one for the file playing.
 */
@Composable
fun CollectionHeader(
  artworkUrl: String?,
  title: String,
  meta: String,
  tracks: List<Track>,
  onPlay: (List<Track>, Int) -> Unit,
  modifier: Modifier = Modifier,
  artworkShape: Shape = MaterialTheme.shapes.extraLarge,
  @DrawableRes placeholder: Int = R.drawable.ic_music_note,
  subtitle: String? = null,
  onSubtitleClick: (() -> Unit)? = null,
  artists: List<ArtistCredit> = emptyList(),
  onOpenArtist: ((Long) -> Unit)? = null,
  dolbyAtmos: Boolean = false,
  aac51: Boolean = false,
  badges: List<String> = emptyList(),
) {
  Column(
    // The top padding leaves room for the page's top bar.
    modifier.fillMaxWidth().statusBarsPadding().padding(top = 64.dp, start = 24.dp, end = 24.dp, bottom = 12.dp),
    horizontalAlignment = Alignment.CenterHorizontally,
  ) {
    Artwork(artworkUrl, Modifier.fillMaxWidth(0.72f).aspectRatio(1f), artworkShape, placeholder)
    Spacer(Modifier.height(24.dp))
    Text(title, style = MaterialTheme.typography.headlineSmallEmphasized, textAlign = TextAlign.Center)
    if (artists.size > 1 && onOpenArtist != null) {
      CreditLinks(artists, onOpenArtist)
    } else if (subtitle != null) {
      Text(
        subtitle,
        style = MaterialTheme.typography.titleMedium,
        // Link colored only when it leads somewhere.
        color = if (onSubtitleClick != null) MaterialTheme.colorScheme.tertiary else MaterialTheme.colorScheme.onSurfaceVariant,
        textAlign = TextAlign.Center,
        modifier =
          Modifier.padding(top = 2.dp)
            .clip(MaterialTheme.shapes.small)
            .clickable(enabled = onSubtitleClick != null) { onSubtitleClick?.invoke() }
            .padding(horizontal = 8.dp, vertical = 2.dp),
      )
    }
    if (meta.isNotEmpty()) {
      Text(
        meta,
        style = MaterialTheme.typography.bodyMedium,
        color = MaterialTheme.colorScheme.onSurfaceVariant,
        textAlign = TextAlign.Center,
        modifier = Modifier.padding(top = 4.dp),
      )
    }
    if (dolbyAtmos || aac51 || badges.isNotEmpty()) {
      Row(Modifier.padding(top = 12.dp), horizontalArrangement = Arrangement.spacedBy(8.dp), verticalAlignment = Alignment.CenterVertically) {
        if (dolbyAtmos) DolbyAtmosBadge()
        if (aac51) Aac51Badge()
        badges.forEach { Badge(it) }
      }
    }
    Spacer(Modifier.height(20.dp))
    PlayButtons(tracks, onPlay)
  }
}

/**
 * The credit line "A, B & C" with each name a link to that artist, laid out as the one-link subtitle
 * is. A pressed name is tinted, since a link inside text has no ripple of its own.
 */
@Composable
private fun CreditLinks(artists: List<ArtistCredit>, onOpenArtist: (Long) -> Unit) {
  val tertiary = MaterialTheme.colorScheme.tertiary
  val styles = TextLinkStyles(style = SpanStyle(color = tertiary), pressedStyle = SpanStyle(color = tertiary, background = tertiary.copy(alpha = 0.16f)))
  val text = buildAnnotatedString {
    artists.forEachIndexed { index, artist ->
      if (index > 0) append(if (index == artists.lastIndex) " & " else ", ")
      withLink(LinkAnnotation.Clickable("artist:${artist.id}", styles) { onOpenArtist(artist.id) }) { append(artist.name) }
    }
  }
  Text(
    text,
    style = MaterialTheme.typography.titleMedium,
    color = MaterialTheme.colorScheme.onSurfaceVariant,
    textAlign = TextAlign.Center,
    modifier = Modifier.padding(top = 2.dp).padding(horizontal = 8.dp, vertical = 2.dp),
  )
}

/** Play [tracks] in order, or shuffled. */
@Composable
fun PlayButtons(tracks: List<Track>, onPlay: (List<Track>, Int) -> Unit, modifier: Modifier = Modifier) {
  Row(modifier, horizontalArrangement = Arrangement.spacedBy(12.dp)) {
    Button(onClick = { onPlay(tracks, 0) }, shapes = ButtonDefaults.shapes(), enabled = tracks.isNotEmpty()) {
      Icon(painterResource(R.drawable.ic_play), contentDescription = null, modifier = Modifier.size(ButtonDefaults.IconSize))
      Spacer(Modifier.width(ButtonDefaults.IconSpacing))
      Text("播放")
    }
    FilledTonalButton(onClick = { onPlay(tracks.shuffled(), 0) }, shapes = ButtonDefaults.shapes(), enabled = tracks.isNotEmpty()) {
      Icon(painterResource(R.drawable.ic_shuffle), contentDescription = null, modifier = Modifier.size(ButtonDefaults.IconSize))
      Spacer(Modifier.width(ButtonDefaults.IconSpacing))
      Text("隨機播放")
    }
  }
}

/** The wordmark's width to its height, from its viewport in R.drawable.dolby_atmos. */
private const val DOLBY_ATMOS_ASPECT = 110.76f / 15.643f

/**
 * The Dolby Atmos wordmark in the same frame as [Badge]'s labels, and as tall. The y of Dolby hangs
 * below everything else, so the wordmark is centred on the rest of it, a little lower than its box
 * would be: the letters and the mark reach 12.03 of its 15.64 units' height.
 */
@Composable
private fun DolbyAtmosBadge() {
  Surface(shape = MaterialTheme.shapes.small, color = MaterialTheme.colorScheme.surfaceContainerHighest) {
    Icon(
      painterResource(R.drawable.dolby_atmos),
      contentDescription = "Dolby Atmos",
      modifier =
        Modifier.padding(start = 10.dp, end = 10.dp, top = 7.4.dp, bottom = 4.6.dp).height(12.dp).aspectRatio(DOLBY_ATMOS_ASPECT),
    )
  }
}

/**
 * The AAC 5.1 mark in the same frame as [Badge]'s labels, its numerals as tall as the Dolby Atmos
 * wordmark's letters and cut through to the frame. They sit in the middle of the mark, so it does too.
 */
@Composable
private fun Aac51Badge() {
  Surface(shape = MaterialTheme.shapes.small, color = MaterialTheme.colorScheme.surfaceContainerHighest) {
    Aac51Logo(
      LocalContentColor.current,
      Modifier.padding(horizontal = 10.dp, vertical = 5.5.dp).height(13.dp).aspectRatio(AAC51_ASPECT).semantics {
        contentDescription = "AAC 5.1"
        role = Role.Image
      },
    )
  }
}

@Composable
private fun Badge(label: String) {
  Surface(shape = MaterialTheme.shapes.small, color = MaterialTheme.colorScheme.surfaceContainerHighest) {
    Text(label, style = MaterialTheme.typography.labelMedium, modifier = Modifier.padding(horizontal = 10.dp, vertical = 4.dp))
  }
}
