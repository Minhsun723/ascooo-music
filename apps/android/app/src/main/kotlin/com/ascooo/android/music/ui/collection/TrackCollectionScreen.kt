package com.ascooo.android.music.ui.collection

import androidx.annotation.DrawableRes
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.itemsIndexed
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.material3.TopAppBarDefaults
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Shape
import androidx.compose.ui.input.nestedscroll.nestedScroll
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import androidx.lifecycle.viewmodel.compose.viewModel
import com.ascooo.android.music.R
import com.ascooo.android.music.appContainer
import com.ascooo.android.music.data.AscoooApi
import com.ascooo.android.music.data.Track
import com.ascooo.android.music.playback.artworkUrl
import com.ascooo.android.music.ui.components.CollectionHeader
import com.ascooo.android.music.ui.components.DetailTopBar
import com.ascooo.android.music.ui.components.ErrorPane
import com.ascooo.android.music.ui.components.Load
import com.ascooo.android.music.ui.components.LoadingPane
import com.ascooo.android.music.ui.components.TrackRow
import com.ascooo.android.music.ui.components.loadOf
import java.time.Instant
import java.time.ZoneId
import java.time.format.DateTimeFormatter
import kotlinx.coroutines.launch

/** What a page of songs shows above its list. */
data class TrackCollection(
  val title: String,
  val meta: String,
  val tracks: List<Track>,
  val artworkId: String? = null,
  val subtitle: String? = null,
)

class TrackCollectionViewModel(private val fetch: suspend () -> TrackCollection) : ViewModel() {
  var collection by mutableStateOf<Load<TrackCollection>>(Load.Loading)
    private set

  init {
    load()
  }

  fun load() {
    viewModelScope.launch {
      collection = Load.Loading
      collection = loadOf { fetch() }
    }
  }
}

@Composable
fun FavoritesScreen(onBack: () -> Unit, onPlay: (List<Track>, Int) -> Unit, currentId: String?, modifier: Modifier = Modifier) {
  TrackCollectionScreen(
    fetch = { api -> api.favorites().tracks.let { TrackCollection("喜愛的歌曲", "${it.size} 首歌", it) } },
    onBack = onBack,
    onPlay = onPlay,
    currentId = currentId,
    placeholder = R.drawable.ic_favorite_filled,
    emptyTitle = "還沒有喜愛的歌曲",
    modifier = modifier,
  )
}

@Composable
fun PlaylistScreen(
  playlistId: Long,
  onBack: () -> Unit,
  onPlay: (List<Track>, Int) -> Unit,
  currentId: String?,
  modifier: Modifier = Modifier,
) {
  TrackCollectionScreen(
    fetch = { api ->
      val (playlist, tracks) = api.playlist(playlistId)
      TrackCollection(
        title = playlist.name,
        subtitle = playlist.description,
        meta = "${tracks.size} 首歌 · 更新於 ${formatDay(playlist.updatedAt)}",
        tracks = tracks,
        artworkId = tracks.firstOrNull()?.artworkId,
      )
    },
    onBack = onBack,
    onPlay = onPlay,
    currentId = currentId,
    placeholder = R.drawable.ic_playlist,
    emptyTitle = "這個播放清單是空的",
    modifier = modifier,
  )
}

@Composable
fun ArtistTracksScreen(
  artistId: Long,
  onBack: () -> Unit,
  onPlay: (List<Track>, Int) -> Unit,
  currentId: String?,
  modifier: Modifier = Modifier,
) {
  TrackCollectionScreen(
    fetch = { api ->
      val (artist, tracks) = api.artistTracks(artistId)
      TrackCollection(artist.name, "${tracks.size} 首歌曲", tracks, artist.artworkId, subtitle = "所有歌曲")
    },
    onBack = onBack,
    onPlay = onPlay,
    currentId = currentId,
    placeholder = R.drawable.ic_person,
    artworkShape = CircleShape,
    emptyTitle = "沒有歌曲",
    modifier = modifier,
  )
}

/** Same as the website's `toLocaleDateString('zh-TW')`, e.g. 2026/11/1. */
private fun formatDay(epochMillis: Long): String =
  Instant.ofEpochMilli(epochMillis).atZone(ZoneId.systemDefault()).format(DateTimeFormatter.ofPattern("yyyy/M/d"))

@Composable
private fun TrackCollectionScreen(
  fetch: suspend (AscoooApi) -> TrackCollection,
  onBack: () -> Unit,
  onPlay: (List<Track>, Int) -> Unit,
  currentId: String?,
  @DrawableRes placeholder: Int,
  emptyTitle: String,
  modifier: Modifier = Modifier,
  artworkShape: Shape = MaterialTheme.shapes.extraLarge,
) {
  val container = LocalContext.current.appContainer
  val viewModel = viewModel { TrackCollectionViewModel { fetch(container.api) } }
  val scrollBehavior = TopAppBarDefaults.pinnedScrollBehavior()
  Box(modifier.fillMaxSize().nestedScroll(scrollBehavior.nestedScrollConnection)) {
    val collection = viewModel.collection
    when (collection) {
      Load.Loading -> LoadingPane()
      is Load.Failed -> ErrorPane(collection.message, viewModel::load)
      is Load.Ready -> {
        val (title, meta, tracks, artworkId, subtitle) = collection.data
        LazyColumn(Modifier.fillMaxSize(), contentPadding = PaddingValues(bottom = 24.dp)) {
          item(key = "header") {
            CollectionHeader(
              artworkUrl = artworkUrl(container.baseUrl, artworkId, 2000),
              title = title,
              subtitle = subtitle,
              meta = meta,
              tracks = tracks,
              onPlay = onPlay,
              artworkShape = artworkShape,
              placeholder = placeholder,
            )
          }
          // The header's cover already shows the icon, so the empty state is just a line of text.
          if (tracks.isEmpty()) {
            item(key = "empty") {
              Text(
                emptyTitle,
                style = MaterialTheme.typography.bodyLarge,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
                textAlign = TextAlign.Center,
                modifier = Modifier.fillMaxWidth().padding(24.dp),
              )
            }
          }
          itemsIndexed(tracks, key = { _, track -> track.id }) { index, track ->
            TrackRow(
              track,
              artworkUrl(container.baseUrl, track.artworkId),
              onClick = { onPlay(tracks, index) },
              current = track.id.toString() == currentId,
            )
          }
        }
      }
    }
    DetailTopBar((collection as? Load.Ready)?.data?.title, onBack, scrollBehavior)
  }
}
