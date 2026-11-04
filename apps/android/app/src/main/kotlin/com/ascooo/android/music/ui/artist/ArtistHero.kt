package com.ascooo.android.music.ui.artist

import android.animation.ValueAnimator
import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.aspectRatio
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clipToBounds
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.RectangleShape
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.compose.LocalLifecycleOwner
import androidx.lifecycle.compose.currentStateAsState
import androidx.media3.common.C
import androidx.media3.common.MediaItem
import androidx.media3.common.Player
import androidx.media3.datasource.okhttp.OkHttpDataSource
import androidx.media3.exoplayer.ExoPlayer
import androidx.media3.exoplayer.hls.HlsMediaSource
import androidx.media3.ui.compose.ContentFrame
import androidx.media3.ui.compose.SURFACE_TYPE_TEXTURE_VIEW
import com.ascooo.android.music.R
import com.ascooo.android.music.appContainer
import com.ascooo.android.music.data.Artist
import com.ascooo.android.music.data.Track
import com.ascooo.android.music.playback.artworkUrl
import com.ascooo.android.music.ui.components.Artwork
import com.ascooo.android.music.ui.components.PlayButtons
import com.ascooo.android.music.ui.player.LocalNowPlayingCovers

/**
 * The top of an artist's page as the website lays it out on a phone: edge to edge, a little taller than
 * square, playing Apple's motion artwork where the artist has some (its square cut, else the wide one,
 * cropped to fill) over a still of it, or else showing their photo; their name, counts and the play
 * buttons sit at its foot as it fades into the page. With animations turned off in the system's settings
 * the still stays still.
 */
@Composable
fun ArtistHero(artist: Artist, baseUrl: String, meta: String, tracks: List<Track>, onPlay: (List<Track>, Int) -> Unit) {
  val motion = artist.squareVideo ?: artist.video
  val animations = remember { ValueAnimator.areAnimatorsEnabled() }
  val page = MaterialTheme.colorScheme.background
  // Taller than square, so the picture still has room above the name and buttons laid over its foot.
  Box(Modifier.fillMaxWidth().aspectRatio(0.85f).clipToBounds()) {
    Artwork(artworkUrl(baseUrl, motion?.previewId ?: artist.artworkId, 2000), Modifier.fillMaxSize(), RectangleShape, R.drawable.ic_person)
    if (motion != null && animations) MotionLoop(motion.url, Modifier.fillMaxSize())
    // The page's own colour behind the status bar and back button, and behind the name, so they read
    // over any picture.
    Box(Modifier.fillMaxWidth().fillMaxHeight(0.3f).background(Brush.verticalGradient(listOf(page.copy(alpha = 0.6f), Color.Transparent))))
    Column(
      Modifier.align(Alignment.BottomStart)
        .fillMaxWidth()
        .background(Brush.verticalGradient(listOf(Color.Transparent, page.copy(alpha = 0.8f), page)))
        .padding(start = 20.dp, end = 20.dp, top = 56.dp, bottom = 12.dp)
    ) {
      Text(artist.name, style = MaterialTheme.typography.displaySmallEmphasized, maxLines = 2, overflow = TextOverflow.Ellipsis)
      Text(meta, style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant, modifier = Modifier.padding(top = 4.dp))
      PlayButtons(tracks, onPlay, Modifier.padding(top = 16.dp))
    }
  }
}

/**
 * A silent loop of motion artwork, through a player of its own rather than the music's: no sound, no
 * audio focus, released with the page. It fades in once its first frame is drawn, so the still under it
 * shows while it loads or should it fail, and plays only while the page is in front: not under Now
 * Playing, nor with the app in the background.
 */
@Composable
private fun MotionLoop(url: String, modifier: Modifier = Modifier) {
  val context = LocalContext.current
  // The app's client signs only requests to our own server, never these to Apple's CDN.
  val httpClient = context.appContainer.httpClient
  val player =
    remember(url) {
      ExoPlayer.Builder(context)
        .setMediaSourceFactory(HlsMediaSource.Factory(OkHttpDataSource.Factory(httpClient)))
        .build()
        .apply {
          volume = 0f
          repeatMode = Player.REPEAT_MODE_ONE
          trackSelectionParameters = trackSelectionParameters.buildUpon().setTrackTypeDisabled(C.TRACK_TYPE_AUDIO, true).build()
          setMediaItem(MediaItem.fromUri(url))
          prepare()
        }
    }
  var drawn by remember(player) { mutableStateOf(false) }
  DisposableEffect(player) {
    player.addListener(
      object : Player.Listener {
        override fun onRenderedFirstFrame() {
          drawn = true
        }
      }
    )
    onDispose { player.release() }
  }
  val covered by LocalNowPlayingCovers.current
  val lifecycle by LocalLifecycleOwner.current.lifecycle.currentStateAsState()
  val run = !covered && lifecycle.isAtLeast(Lifecycle.State.STARTED)
  LaunchedEffect(player, run) { player.playWhenReady = run }
  val alpha by animateFloatAsState(if (drawn) 1f else 0f, MaterialTheme.motionScheme.slowEffectsSpec(), label = "motion artwork")
  ContentFrame(
    player,
    modifier.graphicsLayer { this.alpha = alpha },
    surfaceType = SURFACE_TYPE_TEXTURE_VIEW,
    contentScale = ContentScale.Crop,
    shutter = {},
  )
}
