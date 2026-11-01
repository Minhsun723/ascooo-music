package com.ascooo.android.music.ui.components

import androidx.annotation.DrawableRes
import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.indication
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.aspectRatio
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.statusBars
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.windowInsetsTopHeight
import androidx.compose.foundation.lazy.LazyRow
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.IconButtonDefaults
import androidx.compose.material3.LoadingIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.material3.TopAppBar
import androidx.compose.material3.TopAppBarDefaults
import androidx.compose.material3.TopAppBarScrollBehavior
import androidx.compose.material3.ripple
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Shape
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import coil3.compose.AsyncImage
import com.ascooo.android.music.R
import com.ascooo.android.music.data.Album
import com.ascooo.android.music.data.Artist
import com.ascooo.android.music.data.Track
import com.ascooo.android.music.data.userMessage
import com.ascooo.android.music.playback.artworkUrl
import kotlinx.coroutines.CancellationException

/** Same rules as the website's formatTime: m:ss, or h:mm:ss past an hour. */
fun formatTime(seconds: Double): String {
  if (!seconds.isFinite() || seconds <= 0) return "0:00"
  val s = seconds.toLong()
  val h = s / 3600
  val m = s % 3600 / 60
  val r = (s % 60).toString().padStart(2, '0')
  return if (h > 0) "$h:${m.toString().padStart(2, '0')}:$r" else "$m:$r"
}

/** A cover, or [placeholder] on a plain tile when there is none. */
@Composable
fun Artwork(
  url: String?,
  modifier: Modifier = Modifier,
  shape: Shape = MaterialTheme.shapes.medium,
  @DrawableRes placeholder: Int = R.drawable.ic_music_note,
) {
  Box(
    modifier.clip(shape).background(MaterialTheme.colorScheme.surfaceContainerHigh),
    contentAlignment = Alignment.Center,
  ) {
    if (url == null) {
      Icon(
        painterResource(placeholder),
        contentDescription = null,
        tint = MaterialTheme.colorScheme.onSurfaceVariant,
        modifier = Modifier.fillMaxSize(0.4f),
      )
    } else {
      AsyncImage(model = url, contentDescription = null, contentScale = ContentScale.Crop, modifier = Modifier.fillMaxSize())
    }
  }
}

/** A shelf title, with an optional [action] such as a "see all" button at the end. */
@Composable
fun SectionHeader(title: String, modifier: Modifier = Modifier, action: (@Composable () -> Unit)? = null) {
  Row(
    modifier.fillMaxWidth().padding(start = 20.dp, end = if (action == null) 20.dp else 8.dp, top = 28.dp, bottom = 12.dp),
    verticalAlignment = Alignment.CenterVertically,
  ) {
    Text(title, style = MaterialTheme.typography.titleLargeEmphasized, modifier = Modifier.weight(1f))
    action?.invoke()
  }
}

/**
 * The whole card takes the tap, but only the cover shows the ripple. Clipping the card itself to a
 * rounded shape would cut the corners off its last line of text.
 */
@Composable
private fun CoverCard(
  coverUrl: String?,
  coverShape: Shape,
  @DrawableRes placeholder: Int,
  onClick: () -> Unit,
  modifier: Modifier,
  horizontalAlignment: Alignment.Horizontal = Alignment.Start,
  text: @Composable ColumnScope.() -> Unit,
) {
  val interaction = remember { MutableInteractionSource() }
  Column(modifier.clickable(interaction, indication = null, onClick = onClick), horizontalAlignment = horizontalAlignment) {
    Artwork(
      coverUrl,
      Modifier.fillMaxWidth().aspectRatio(1f).clip(coverShape).indication(interaction, ripple()),
      coverShape,
      placeholder,
    )
    text()
  }
}

/** An album cover over its title and artist. The caller sets the width; the cover stays square. */
@Composable
fun AlbumCard(album: Album, baseUrl: String, onClick: () -> Unit, modifier: Modifier = Modifier) {
  CoverCard(artworkUrl(baseUrl, album.artworkId), MaterialTheme.shapes.large, R.drawable.ic_music_note, onClick, modifier) {
    Text(
      album.title,
      style = MaterialTheme.typography.titleSmall,
      maxLines = 1,
      overflow = TextOverflow.Ellipsis,
      modifier = Modifier.padding(top = 8.dp),
    )
    Text(
      album.artist,
      style = MaterialTheme.typography.bodySmall,
      color = MaterialTheme.colorScheme.onSurfaceVariant,
      maxLines = 1,
      overflow = TextOverflow.Ellipsis,
    )
  }
}

/** A round artist photo over their name. */
@Composable
fun ArtistCard(artist: Artist, baseUrl: String, onClick: () -> Unit, modifier: Modifier = Modifier) {
  CoverCard(artworkUrl(baseUrl, artist.artworkId), CircleShape, R.drawable.ic_person, onClick, modifier, Alignment.CenterHorizontally) {
    Text(
      artist.name,
      style = MaterialTheme.typography.titleSmall,
      textAlign = TextAlign.Center,
      maxLines = 1,
      overflow = TextOverflow.Ellipsis,
      modifier = Modifier.padding(top = 8.dp, bottom = 4.dp),
    )
  }
}

/** A sideways-scrolling row of albums. */
@Composable
fun AlbumShelf(albums: List<Album>, baseUrl: String, onOpenAlbum: (Long) -> Unit, modifier: Modifier = Modifier) {
  LazyRow(modifier, contentPadding = PaddingValues(horizontal = 20.dp), horizontalArrangement = Arrangement.spacedBy(14.dp)) {
    items(albums, key = { it.id }) { album ->
      AlbumCard(album, baseUrl, onClick = { onOpenAlbum(album.id) }, Modifier.width(148.dp))
    }
  }
}

/** A sideways-scrolling row of artists. */
@Composable
fun ArtistShelf(artists: List<Artist>, baseUrl: String, onOpenArtist: (Long) -> Unit, modifier: Modifier = Modifier) {
  LazyRow(modifier, contentPadding = PaddingValues(horizontal = 20.dp), horizontalArrangement = Arrangement.spacedBy(14.dp)) {
    items(artists, key = { it.id }) { artist ->
      ArtistCard(artist, baseUrl, onClick = { onOpenArtist(artist.id) }, Modifier.width(112.dp))
    }
  }
}

/**
 * A detail page's top bar. Over the header it is only a back button; once the list scrolls under it,
 * it fills in and shows [title], which also keeps the content off the status bar.
 */
@Composable
fun DetailTopBar(title: String?, onBack: () -> Unit, scrollBehavior: TopAppBarScrollBehavior, modifier: Modifier = Modifier) {
  val scrolled = scrollBehavior.state.overlappedFraction > 0.01f
  val titleAlpha by animateFloatAsState(if (scrolled) 1f else 0f, MaterialTheme.motionScheme.fastEffectsSpec(), label = "title")
  TopAppBar(
    title = {
      if (title != null) {
        Text(title, maxLines = 1, overflow = TextOverflow.Ellipsis, modifier = Modifier.graphicsLayer { alpha = titleAlpha })
      }
    },
    modifier = modifier,
    navigationIcon = {
      IconButton(onClick = onBack, shapes = IconButtonDefaults.shapes()) {
        Icon(painterResource(R.drawable.ic_back), contentDescription = "返回")
      }
    },
    colors =
      TopAppBarDefaults.topAppBarColors(
        containerColor = Color.Transparent,
        scrolledContainerColor = MaterialTheme.colorScheme.surfaceContainer,
      ),
    scrollBehavior = scrollBehavior,
  )
}

/** Covers the status bar on screens whose content scrolls up under it. */
@Composable
fun StatusBarScrim(modifier: Modifier = Modifier) {
  Box(modifier.fillMaxWidth().windowInsetsTopHeight(WindowInsets.statusBars).background(MaterialTheme.colorScheme.background))
}

/** A track in a list, led by its [number] on album pages and by its cover elsewhere. */
@Composable
fun TrackRow(
  track: Track,
  artworkUrl: String?,
  onClick: () -> Unit,
  modifier: Modifier = Modifier,
  number: Int? = null,
  current: Boolean = false,
) {
  Row(
    modifier.fillMaxWidth().clickable(onClick = onClick).padding(horizontal = 20.dp, vertical = 8.dp),
    verticalAlignment = Alignment.CenterVertically,
  ) {
    if (number != null) {
      Text(
        number.toString(),
        style = MaterialTheme.typography.bodyMedium,
        color = if (current) MaterialTheme.colorScheme.tertiary else MaterialTheme.colorScheme.onSurfaceVariant,
        textAlign = TextAlign.Center,
        modifier = Modifier.width(28.dp),
      )
    } else {
      Artwork(artworkUrl, Modifier.size(48.dp), MaterialTheme.shapes.small)
    }
    Spacer(Modifier.width(14.dp))
    Column(Modifier.weight(1f)) {
      Text(
        track.title,
        style = MaterialTheme.typography.bodyLarge,
        color = if (current) MaterialTheme.colorScheme.tertiary else MaterialTheme.colorScheme.onSurface,
        maxLines = 1,
        overflow = TextOverflow.Ellipsis,
      )
      Text(
        track.artist,
        style = MaterialTheme.typography.bodyMedium,
        color = MaterialTheme.colorScheme.onSurfaceVariant,
        maxLines = 1,
        overflow = TextOverflow.Ellipsis,
      )
    }
    Spacer(Modifier.width(12.dp))
    Text(formatTime(track.duration), style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
  }
}

@Composable
fun LoadingPane(modifier: Modifier = Modifier) {
  Box(modifier.fillMaxSize(), contentAlignment = Alignment.Center) { LoadingIndicator() }
}

@Composable
fun ErrorPane(message: String, onRetry: () -> Unit, modifier: Modifier = Modifier) {
  Column(
    modifier.fillMaxSize().padding(32.dp),
    verticalArrangement = Arrangement.Center,
    horizontalAlignment = Alignment.CenterHorizontally,
  ) {
    Text(message, style = MaterialTheme.typography.bodyLarge, textAlign = TextAlign.Center)
    Spacer(Modifier.height(16.dp))
    Button(onClick = onRetry, shapes = ButtonDefaults.shapes()) { Text("重試") }
  }
}

/** Stands in for a list with nothing in it yet. */
@Composable
fun EmptyPane(@DrawableRes icon: Int, title: String, modifier: Modifier = Modifier, copy: String? = null) {
  Column(
    modifier.fillMaxSize().padding(32.dp),
    verticalArrangement = Arrangement.Center,
    horizontalAlignment = Alignment.CenterHorizontally,
  ) {
    Icon(painterResource(icon), contentDescription = null, tint = MaterialTheme.colorScheme.onSurfaceVariant, modifier = Modifier.size(48.dp))
    Spacer(Modifier.height(16.dp))
    Text(title, style = MaterialTheme.typography.titleLargeEmphasized, textAlign = TextAlign.Center)
    if (copy != null) {
      Spacer(Modifier.height(8.dp))
      Text(copy, style = MaterialTheme.typography.bodyLarge, color = MaterialTheme.colorScheme.onSurfaceVariant, textAlign = TextAlign.Center)
    }
  }
}

/** Loading state of a screen's one request. */
sealed interface Load<out T> {
  data object Loading : Load<Nothing>

  data class Ready<T>(val data: T) : Load<T>

  data class Failed(val message: String) : Load<Nothing>
}

suspend fun <T> loadOf(request: suspend () -> T): Load<T> =
  try {
    Load.Ready(request())
  } catch (e: CancellationException) {
    throw e
  } catch (e: Exception) {
    Load.Failed(e.userMessage())
  }
