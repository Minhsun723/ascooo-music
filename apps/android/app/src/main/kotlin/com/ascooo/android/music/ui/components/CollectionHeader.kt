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
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Shape
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import com.ascooo.android.music.R
import com.ascooo.android.music.data.Track

/**
 * The top of an album, artist or playlist page: the cover, the title, an optional [subtitle] that
 * can link elsewhere, a [meta] line, [badges] and the play and shuffle buttons for [tracks].
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
    if (subtitle != null) {
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
    Text(
      meta,
      style = MaterialTheme.typography.bodyMedium,
      color = MaterialTheme.colorScheme.onSurfaceVariant,
      textAlign = TextAlign.Center,
      modifier = Modifier.padding(top = 4.dp),
    )
    if (badges.isNotEmpty()) {
      Row(Modifier.padding(top = 12.dp), horizontalArrangement = Arrangement.spacedBy(8.dp)) { badges.forEach { Badge(it) } }
    }
    Spacer(Modifier.height(20.dp))
    PlayButtons(tracks, onPlay)
  }
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

@Composable
private fun Badge(label: String) {
  Surface(shape = MaterialTheme.shapes.small, color = MaterialTheme.colorScheme.surfaceContainerHighest) {
    Text(label, style = MaterialTheme.typography.labelMedium, modifier = Modifier.padding(horizontal = 10.dp, vertical = 4.dp))
  }
}
