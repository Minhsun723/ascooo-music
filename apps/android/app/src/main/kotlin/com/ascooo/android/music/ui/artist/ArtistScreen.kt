package com.ascooo.android.music.ui.artist

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.lazy.itemsIndexed
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
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
import com.ascooo.android.music.data.ArtistDetail
import com.ascooo.android.music.data.AscoooApi
import com.ascooo.android.music.data.Track
import com.ascooo.android.music.playback.artworkUrl
import com.ascooo.android.music.ui.components.AlbumCard
import com.ascooo.android.music.ui.components.DetailTopBar
import com.ascooo.android.music.ui.components.ErrorPane
import com.ascooo.android.music.ui.components.Load
import com.ascooo.android.music.ui.components.LoadingPane
import com.ascooo.android.music.ui.components.SectionHeader
import com.ascooo.android.music.ui.components.TrackRow
import com.ascooo.android.music.ui.components.loadOf
import kotlinx.coroutines.launch

class ArtistViewModel(private val api: AscoooApi, private val artistId: Long) : ViewModel() {
  var artist by mutableStateOf<Load<ArtistDetail>>(Load.Loading)
    private set

  init {
    load()
  }

  fun load() {
    viewModelScope.launch {
      artist = Load.Loading
      artist = loadOf { api.artist(artistId) }
    }
  }
}

@Composable
fun ArtistScreen(
  artistId: Long,
  onBack: () -> Unit,
  onOpenAlbum: (Long) -> Unit,
  onOpenAllTracks: () -> Unit,
  onPlay: (List<Track>, Int) -> Unit,
  currentId: String?,
  modifier: Modifier = Modifier,
) {
  val container = LocalContext.current.appContainer
  val viewModel = viewModel { ArtistViewModel(container.api, artistId) }
  val scrollBehavior = TopAppBarDefaults.pinnedScrollBehavior()
  Box(modifier.fillMaxSize().nestedScroll(scrollBehavior.nestedScrollConnection)) {
    val artist = viewModel.artist
    when (artist) {
      Load.Loading -> LoadingPane()
      is Load.Failed -> ErrorPane(artist.message, viewModel::load)
      is Load.Ready -> ArtistContent(artist.data, container.baseUrl, onOpenAlbum, onOpenAllTracks, onPlay, currentId)
    }
    DetailTopBar((artist as? Load.Ready)?.data?.artist?.name, onBack, scrollBehavior)
  }
}

// Laid out like the website's artist page: popular songs, then every album.
@Composable
private fun ArtistContent(
  detail: ArtistDetail,
  baseUrl: String,
  onOpenAlbum: (Long) -> Unit,
  onOpenAllTracks: () -> Unit,
  onPlay: (List<Track>, Int) -> Unit,
  currentId: String?,
) {
  val (artist, albums, tracks) = detail
  LazyColumn(Modifier.fillMaxSize(), contentPadding = PaddingValues(bottom = 24.dp)) {
    item(key = "header") { ArtistHero(artist, baseUrl, "${albums.size} 張專輯 · ${tracks.size} 首熱門歌曲", tracks, onPlay) }
    if (tracks.isNotEmpty()) {
      item(key = "top-title") {
        SectionHeader("熱門歌曲") {
          TextButton(onClick = onOpenAllTracks, shapes = ButtonDefaults.shapes()) { Text("所有歌曲") }
        }
      }
      itemsIndexed(tracks.take(10), key = { _, track -> track.id }) { index, track ->
        TrackRow(track, artworkUrl(baseUrl, track.artworkId), onClick = { onPlay(tracks, index) }, current = track.id.toString() == currentId)
      }
    }
    if (albums.isNotEmpty()) {
      item(key = "albums-title") { SectionHeader("專輯") }
      // Two to a row; a grid inside this list would need its own scroll container.
      items(albums.chunked(2), key = { row -> "albums-${row.first().id}" }) { row ->
        Row(
          Modifier.fillMaxWidth().padding(horizontal = 20.dp, vertical = 10.dp),
          horizontalArrangement = Arrangement.spacedBy(14.dp),
        ) {
          row.forEach { album -> AlbumCard(album, baseUrl, onClick = { onOpenAlbum(album.id) }, Modifier.weight(1f)) }
          if (row.size == 1) Spacer(Modifier.weight(1f))
        }
      }
    }
  }
}
