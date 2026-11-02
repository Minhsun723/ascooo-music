package com.ascooo.android.music.ui.home

import androidx.compose.foundation.Image
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.LazyListScope
import androidx.compose.foundation.lazy.itemsIndexed
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.unit.dp
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import androidx.lifecycle.viewmodel.compose.viewModel
import com.ascooo.android.music.R
import com.ascooo.android.music.appContainer
import com.ascooo.android.music.data.Album
import com.ascooo.android.music.data.AscoooApi
import com.ascooo.android.music.data.HomeCache
import com.ascooo.android.music.data.HomeData
import com.ascooo.android.music.data.Track
import com.ascooo.android.music.playback.artworkUrl
import com.ascooo.android.music.ui.components.AlbumShelf
import com.ascooo.android.music.ui.components.ErrorPane
import com.ascooo.android.music.ui.components.Load
import com.ascooo.android.music.ui.components.LoadingPane
import com.ascooo.android.music.ui.components.SectionHeader
import com.ascooo.android.music.ui.components.StatusBarScrim
import com.ascooo.android.music.ui.components.TrackRow
import com.ascooo.android.music.ui.components.loadOf
import kotlinx.coroutines.launch

class HomeViewModel(private val api: AscoooApi, private val cache: HomeCache) : ViewModel() {
  var home by mutableStateOf<Load<HomeData>>(Load.Loading)
    private set

  init {
    // A start opens straight onto the saved page; only a stale one is fetched again, behind it.
    viewModelScope.launch {
      val saved = cache.read()
      if (saved != null) home = Load.Ready(saved.home)
      if (saved?.fresh != true) fetch()
    }
  }

  fun load() {
    viewModelScope.launch {
      home = Load.Loading
      fetch()
    }
  }

  private suspend fun fetch() {
    val fresh = loadOf { api.home(cache.seed()) }
    if (fresh is Load.Ready) cache.write(fresh.data)
    // A failed refresh leaves the saved page up rather than an error.
    if (fresh is Load.Ready || home !is Load.Ready) home = fresh
  }
}

@Composable
fun HomeScreen(
  onOpenAlbum: (Long) -> Unit,
  onPlay: (List<Track>, Int) -> Unit,
  currentId: String?,
  modifier: Modifier = Modifier,
) {
  val container = LocalContext.current.appContainer
  val viewModel = viewModel { HomeViewModel(container.api, container.homeCache) }
  when (val home = viewModel.home) {
    Load.Loading -> LoadingPane(modifier)
    is Load.Failed -> ErrorPane(home.message, viewModel::load, modifier)
    is Load.Ready -> HomeContent(home.data, container.baseUrl, onOpenAlbum, onPlay, currentId, modifier)
  }
}

// The same four shelves, in the same order and with the same names, as the website's home page.
@Composable
private fun HomeContent(
  data: HomeData,
  baseUrl: String,
  onOpenAlbum: (Long) -> Unit,
  onPlay: (List<Track>, Int) -> Unit,
  currentId: String?,
  modifier: Modifier = Modifier,
) {
  Box(modifier.fillMaxSize()) {
    LazyColumn(Modifier.fillMaxSize(), contentPadding = PaddingValues(bottom = 24.dp)) {
      item {
        Image(
          painterResource(R.drawable.brand_logo),
          contentDescription = "Ascooo Music",
          modifier = Modifier.statusBarsPadding().padding(start = 20.dp, top = 16.dp).height(30.dp),
        )
      }
      trackShelf("現在就播放", data.quickPicks.take(10), baseUrl, onPlay, currentId)
      albumShelf("新進唱片櫃", data.recentAlbums.take(12), baseUrl, onOpenAlbum)
      trackShelf("最近聽過", data.recentPlays.take(8), baseUrl, onPlay, currentId)
      albumShelf("再翻一張唱片", data.randomAlbums.take(12), baseUrl, onOpenAlbum)
      if (data.quickPicks.isEmpty()) item { SectionHeader("音樂庫暫無內容") }
    }
    StatusBarScrim()
  }
}

private fun LazyListScope.trackShelf(
  title: String,
  tracks: List<Track>,
  baseUrl: String,
  onPlay: (List<Track>, Int) -> Unit,
  currentId: String?,
) {
  if (tracks.isEmpty()) return
  item(key = "title-$title") { SectionHeader(title) }
  itemsIndexed(tracks, key = { _, track -> "$title-${track.id}" }) { index, track ->
    TrackRow(
      track,
      artworkUrl(baseUrl, track.artworkId),
      onClick = { onPlay(tracks, index) },
      current = track.id.toString() == currentId,
    )
  }
}

private fun LazyListScope.albumShelf(
  title: String,
  albums: List<Album>,
  baseUrl: String,
  onOpenAlbum: (Long) -> Unit,
) {
  if (albums.isEmpty()) return
  item(key = "title-$title") { SectionHeader(title) }
  item(key = "shelf-$title") { AlbumShelf(albums, baseUrl, onOpenAlbum) }
}
