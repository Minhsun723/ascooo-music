package com.ascooo.android.music.ui.album

import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.itemsIndexed
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.material3.TopAppBarDefaults
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.input.nestedscroll.nestedScroll
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.unit.dp
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import androidx.lifecycle.viewmodel.compose.viewModel
import com.ascooo.android.music.appContainer
import com.ascooo.android.music.data.AlbumDetail
import com.ascooo.android.music.data.AscoooApi
import com.ascooo.android.music.data.Track
import com.ascooo.android.music.playback.artworkUrl
import com.ascooo.android.music.ui.components.AlbumShelf
import com.ascooo.android.music.ui.components.CollectionHeader
import com.ascooo.android.music.ui.components.DetailTopBar
import com.ascooo.android.music.ui.components.ErrorPane
import com.ascooo.android.music.ui.components.Load
import com.ascooo.android.music.ui.components.LoadingPane
import com.ascooo.android.music.ui.components.SectionHeader
import com.ascooo.android.music.ui.components.TrackRow
import com.ascooo.android.music.ui.components.loadOf
import kotlin.math.roundToInt
import kotlinx.coroutines.launch

class AlbumViewModel(private val api: AscoooApi, private val albumId: Long) : ViewModel() {
  var album by mutableStateOf<Load<AlbumDetail>>(Load.Loading)
    private set

  init {
    load()
  }

  fun load() {
    viewModelScope.launch {
      album = Load.Loading
      album = loadOf { api.album(albumId) }
    }
  }
}

@Composable
fun AlbumScreen(
  albumId: Long,
  onBack: () -> Unit,
  onOpenAlbum: (Long) -> Unit,
  onOpenArtist: (Long) -> Unit,
  onPlay: (List<Track>, Int) -> Unit,
  currentId: String?,
  modifier: Modifier = Modifier,
) {
  val container = LocalContext.current.appContainer
  val viewModel = viewModel { AlbumViewModel(container.api, albumId) }
  val scrollBehavior = TopAppBarDefaults.pinnedScrollBehavior()
  Box(modifier.fillMaxSize().nestedScroll(scrollBehavior.nestedScrollConnection)) {
    val album = viewModel.album
    when (album) {
      Load.Loading -> LoadingPane()
      is Load.Failed -> ErrorPane(album.message, viewModel::load)
      is Load.Ready -> AlbumContent(album.data, container.baseUrl, onOpenAlbum, onOpenArtist, onPlay, currentId)
    }
    DetailTopBar((album as? Load.Ready)?.data?.album?.title, onBack, scrollBehavior)
  }
}

@Composable
private fun AlbumContent(
  detail: AlbumDetail,
  baseUrl: String,
  onOpenAlbum: (Long) -> Unit,
  onOpenArtist: (Long) -> Unit,
  onPlay: (List<Track>, Int) -> Unit,
  currentId: String?,
) {
  val album = detail.album
  val tracks = detail.tracks
  // The first credited artist, whose other albums the page lists, as on the website.
  val leadArtist = album.artists.firstOrNull()
  LazyColumn(Modifier.fillMaxSize(), contentPadding = PaddingValues(bottom = 24.dp)) {
    item {
      CollectionHeader(
        artworkUrl = artworkUrl(baseUrl, album.artworkId, 2000),
        title = album.title,
        subtitle = album.artist,
        onSubtitleClick = (leadArtist?.id ?: album.artistId)?.let { id -> { onOpenArtist(id) } },
        meta = listOfNotNull(album.year?.toString(), "${tracks.size} 首歌", "${(album.duration / 60).roundToInt()} 分鐘").joinToString(" · "),
        badges = listOfNotNull("Dolby Atmos".takeIf { album.atmos }, "無損".takeIf { album.lossless }),
        tracks = tracks,
        onPlay = onPlay,
      )
    }
    itemsIndexed(tracks, key = { _, track -> track.id }) { index, track ->
      TrackRow(
        track,
        artworkUrl = null,
        onClick = { onPlay(tracks, index) },
        number = track.trackNo ?: (index + 1),
        current = track.id.toString() == currentId,
      )
    }
    album.releaseDate?.let { date ->
      item {
        Text(
          date,
          style = MaterialTheme.typography.bodySmall,
          color = MaterialTheme.colorScheme.onSurfaceVariant,
          modifier = Modifier.padding(horizontal = 20.dp, vertical = 16.dp),
        )
      }
    }
    if (detail.moreByArtist.isNotEmpty()) {
      item { SectionHeader("更多 ${leadArtist?.name ?: album.artist}") }
      item { AlbumShelf(detail.moreByArtist, baseUrl, onOpenAlbum) }
    }
  }
}
