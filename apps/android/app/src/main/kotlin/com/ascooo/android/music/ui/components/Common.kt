package com.ascooo.android.music.ui.components

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.Icon
import androidx.compose.material3.LoadingIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Shape
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import coil3.compose.AsyncImage
import com.ascooo.android.music.R
import com.ascooo.android.music.data.Track
import com.ascooo.android.music.data.userMessage
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

@Composable
fun Artwork(url: String?, modifier: Modifier = Modifier, shape: Shape = MaterialTheme.shapes.medium) {
  Box(
    modifier.clip(shape).background(MaterialTheme.colorScheme.surfaceContainerHigh),
    contentAlignment = Alignment.Center,
  ) {
    if (url == null) {
      Icon(
        painterResource(R.drawable.ic_music_note),
        contentDescription = null,
        tint = MaterialTheme.colorScheme.onSurfaceVariant,
        modifier = Modifier.fillMaxSize(0.4f),
      )
    } else {
      AsyncImage(model = url, contentDescription = null, contentScale = ContentScale.Crop, modifier = Modifier.fillMaxSize())
    }
  }
}

@Composable
fun SectionHeader(title: String, modifier: Modifier = Modifier) {
  Text(
    title,
    style = MaterialTheme.typography.titleLargeEmphasized,
    modifier = modifier.padding(start = 20.dp, end = 20.dp, top = 28.dp, bottom = 12.dp),
  )
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

/** Search and the library arrive in later milestones. */
@Composable
fun ComingSoon(title: String, modifier: Modifier = Modifier) {
  Column(
    modifier.fillMaxSize().padding(32.dp),
    verticalArrangement = Arrangement.Center,
    horizontalAlignment = Alignment.CenterHorizontally,
  ) {
    Text(title, style = MaterialTheme.typography.headlineSmallEmphasized)
    Spacer(Modifier.height(8.dp))
    Text("即將推出", style = MaterialTheme.typography.bodyLarge, color = MaterialTheme.colorScheme.onSurfaceVariant)
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
