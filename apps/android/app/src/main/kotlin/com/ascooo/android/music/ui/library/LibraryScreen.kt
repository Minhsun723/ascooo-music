package com.ascooo.android.music.ui.library

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.grid.GridCells
import androidx.compose.foundation.lazy.grid.LazyVerticalGrid
import androidx.compose.foundation.lazy.grid.items
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.lazy.itemsIndexed
import androidx.compose.foundation.pager.HorizontalPager
import androidx.compose.foundation.pager.rememberPagerState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.ButtonGroupDefaults
import androidx.compose.material3.FilledTonalButton
import androidx.compose.material3.Icon
import androidx.compose.material3.ListItem
import androidx.compose.material3.ListItemDefaults
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.ToggleButton
import androidx.compose.material3.pulltorefresh.PullToRefreshBox
import androidx.compose.material3.pulltorefresh.PullToRefreshDefaults
import androidx.compose.material3.pulltorefresh.rememberPullToRefreshState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.role
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.lifecycle.ViewModel
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewModelScope
import androidx.lifecycle.viewmodel.compose.viewModel
import com.ascooo.android.music.R
import com.ascooo.android.music.appContainer
import com.ascooo.android.music.data.Album
import com.ascooo.android.music.data.Artist
import com.ascooo.android.music.data.AscoooApi
import com.ascooo.android.music.data.Playlist
import com.ascooo.android.music.data.PlaylistsRepository
import com.ascooo.android.music.data.Track
import com.ascooo.android.music.playback.artworkUrl
import com.ascooo.android.music.ui.components.AlbumCard
import com.ascooo.android.music.ui.components.Artwork
import com.ascooo.android.music.ui.components.EmptyPane
import com.ascooo.android.music.ui.components.ErrorPane
import com.ascooo.android.music.ui.components.Load
import com.ascooo.android.music.ui.components.LoadingPane
import com.ascooo.android.music.ui.components.PlaylistNameDialog
import com.ascooo.android.music.ui.components.TrackRow
import com.ascooo.android.music.ui.components.loadOf
import kotlinx.coroutines.async
import kotlinx.coroutines.coroutineScope
import kotlinx.coroutines.launch

/** The playlists live in [PlaylistsRepository], which the track menus share. */
data class LibraryData(
  val albums: List<Album>,
  val tracks: List<Track>,
  val artists: List<Artist>,
)

class LibraryViewModel(private val api: AscoooApi, private val playlists: PlaylistsRepository) : ViewModel() {
  var library by mutableStateOf<Load<LibraryData>>(Load.Loading)
    private set

  /** A pull to refresh, which keeps the current lists on screen until the new ones arrive. */
  var refreshing by mutableStateOf(false)
    private set

  init {
    load()
  }

  fun load() {
    viewModelScope.launch {
      library = Load.Loading
      library = fetch()
    }
  }

  fun refresh() {
    viewModelScope.launch {
      refreshing = true
      val fresh = fetch()
      // A failed refresh keeps what is already showing rather than replacing it with an error.
      if (fresh is Load.Ready || library !is Load.Ready) library = fresh
      refreshing = false
    }
  }

  private suspend fun fetch() = loadOf {
    coroutineScope {
      val albums = async { api.albums().albums }
      val tracks = async { api.tracks().tracks }
      val artists = async { api.artists().artists }
      val playlistsLoaded = async { playlists.refresh() }
      playlistsLoaded.await()
      LibraryData(albums.await(), tracks.await(), artists.await())
    }
  }
}

/** The same four sections as the website's library page. */
private enum class Section(val label: String) {
  Albums("專輯"),
  Tracks("歌曲"),
  Artists("藝人"),
  Playlists("播放清單"),
}

@Composable
fun LibraryScreen(
  onOpenAlbum: (Long) -> Unit,
  onOpenArtist: (Long) -> Unit,
  onOpenPlaylist: (Long) -> Unit,
  onOpenFavorites: () -> Unit,
  onPlay: (List<Track>, Int) -> Unit,
  currentId: String?,
  modifier: Modifier = Modifier,
) {
  val container = LocalContext.current.appContainer
  val viewModel = viewModel { LibraryViewModel(container.api, container.playlists) }
  val playlists by container.playlists.playlists.collectAsStateWithLifecycle()
  val pager = rememberPagerState { Section.entries.size }
  val scope = rememberCoroutineScope()
  // A tapped section lights up at once and stays lit while the pager travels to it. A swipe moves
  // the selection when the pager passes halfway, which never jumps back mid-drag the way
  // targetPage does.
  var tapped by remember { mutableStateOf<Int?>(null) }
  val selected = tapped ?: pager.currentPage

  Column(modifier.fillMaxSize().statusBarsPadding()) {
    Text("音樂庫", style = MaterialTheme.typography.headlineMediumEmphasized, modifier = Modifier.padding(start = 20.dp, top = 24.dp, bottom = 12.dp))
    // A connected button group, M3 Expressive's replacement for segmented buttons.
    Row(
      Modifier.fillMaxWidth().padding(horizontal = 16.dp),
      horizontalArrangement = Arrangement.spacedBy(ButtonGroupDefaults.ConnectedSpaceBetween),
    ) {
      Section.entries.forEachIndexed { index, section ->
        ToggleButton(
          checked = selected == index,
          onCheckedChange = {
            tapped = index
            scope.launch {
              try {
                pager.animateScrollToPage(index)
              } finally {
                // A later tap or a swipe may have taken over; only clear our own.
                if (tapped == index) tapped = null
              }
            }
          },
          shapes =
            when (index) {
              0 -> ButtonGroupDefaults.connectedLeadingButtonShapes()
              Section.entries.lastIndex -> ButtonGroupDefaults.connectedTrailingButtonShapes()
              else -> ButtonGroupDefaults.connectedMiddleButtonShapes()
            },
          contentPadding = PaddingValues(horizontal = 8.dp),
          modifier = Modifier.weight(1f).semantics { role = Role.RadioButton },
        ) {
          Text(section.label, maxLines = 1, overflow = TextOverflow.Ellipsis)
        }
      }
    }

    when (val library = viewModel.library) {
      Load.Loading -> LoadingPane()
      is Load.Failed -> ErrorPane(library.message, viewModel::load)
      is Load.Ready -> {
        val pullState = rememberPullToRefreshState()
        PullToRefreshBox(
          isRefreshing = viewModel.refreshing,
          onRefresh = viewModel::refresh,
          state = pullState,
          modifier = Modifier.padding(top = 8.dp),
          indicator = {
            PullToRefreshDefaults.LoadingIndicator(pullState, viewModel.refreshing, Modifier.align(Alignment.TopCenter))
          },
        ) {
          HorizontalPager(pager, Modifier.fillMaxSize(), beyondViewportPageCount = 1) { page ->
            val data = library.data
            val baseUrl = container.baseUrl
            when (Section.entries[page]) {
              Section.Albums -> AlbumsPage(data.albums, baseUrl, onOpenAlbum)
              Section.Tracks -> TracksPage(data.tracks, baseUrl, onPlay, currentId)
              Section.Artists -> ArtistsPage(data.artists, baseUrl, onOpenArtist)
              Section.Playlists -> PlaylistsPage(playlists.orEmpty(), baseUrl, onOpenPlaylist, onOpenFavorites)
            }
          }
        }
      }
    }
  }
}

@Composable
private fun AlbumsPage(albums: List<Album>, baseUrl: String, onOpenAlbum: (Long) -> Unit) {
  if (albums.isEmpty()) {
    EmptyPane(R.drawable.ic_library_music, "還沒有專輯", copy = "同步歌曲後，系統會依照內嵌資訊整理專輯。")
    return
  }
  LazyVerticalGrid(
    GridCells.Adaptive(150.dp),
    Modifier.fillMaxSize(),
    contentPadding = PaddingValues(start = 20.dp, end = 20.dp, top = 12.dp, bottom = 24.dp),
    horizontalArrangement = Arrangement.spacedBy(14.dp),
    verticalArrangement = Arrangement.spacedBy(20.dp),
  ) {
    items(albums, key = { it.id }) { album -> AlbumCard(album, baseUrl, onClick = { onOpenAlbum(album.id) }) }
  }
}

@Composable
private fun TracksPage(tracks: List<Track>, baseUrl: String, onPlay: (List<Track>, Int) -> Unit, currentId: String?) {
  if (tracks.isEmpty()) {
    EmptyPane(R.drawable.ic_music_note, "還沒有歌曲", copy = "前往網頁版的設定頁執行 PikPak 同步。")
    return
  }
  LazyColumn(Modifier.fillMaxSize(), contentPadding = PaddingValues(bottom = 24.dp)) {
    item(key = "shuffle") {
      FilledTonalButton(
        onClick = { onPlay(tracks.shuffled(), 0) },
        shapes = ButtonDefaults.shapes(),
        modifier = Modifier.padding(horizontal = 20.dp, vertical = 8.dp),
      ) {
        Icon(painterResource(R.drawable.ic_shuffle), contentDescription = null, modifier = Modifier.size(ButtonDefaults.IconSize))
        Spacer(Modifier.width(ButtonDefaults.IconSpacing))
        Text("隨機播放")
      }
    }
    itemsIndexed(tracks, key = { _, track -> track.id }) { index, track ->
      TrackRow(track, artworkUrl(baseUrl, track.artworkId), onClick = { onPlay(tracks, index) }, current = track.id.toString() == currentId)
    }
  }
}

@Composable
private fun ArtistsPage(artists: List<Artist>, baseUrl: String, onOpenArtist: (Long) -> Unit) {
  if (artists.isEmpty()) {
    EmptyPane(R.drawable.ic_person, "還沒有藝人", copy = "同步歌曲後，藝人會自動出現在這裡。")
    return
  }
  LazyColumn(Modifier.fillMaxSize(), contentPadding = PaddingValues(top = 4.dp, bottom = 24.dp)) {
    items(artists, key = { it.id }) { artist ->
      LibraryRow(
        title = artist.name,
        supporting = "${artist.trackCount} 首歌曲",
        onClick = { onOpenArtist(artist.id) },
        leading = { Artwork(artworkUrl(baseUrl, artist.artworkId), Modifier.size(56.dp), CircleShape, R.drawable.ic_person) },
      )
    }
  }
}

@Composable
private fun PlaylistsPage(playlists: List<Playlist>, baseUrl: String, onOpenPlaylist: (Long) -> Unit, onOpenFavorites: () -> Unit) {
  val container = LocalContext.current.appContainer
  val scope = rememberCoroutineScope()
  var naming by rememberSaveable { mutableStateOf(false) }
  if (naming) {
    PlaylistNameDialog(
      title = "新增播放清單",
      confirmLabel = "建立",
      onDismiss = { naming = false },
      onConfirm = { name ->
        naming = false
        // Opens the new playlist, as the website does.
        scope.launch { container.playlists.create(name)?.let(onOpenPlaylist) }
      },
    )
  }
  LazyColumn(Modifier.fillMaxSize(), contentPadding = PaddingValues(top = 4.dp, bottom = 24.dp)) {
    // The website keeps favorites in its sidebar; here they lead the playlists.
    item(key = "favorites") {
      LibraryRow(
        title = "喜愛的歌曲",
        supporting = "你按過愛心的歌",
        onClick = onOpenFavorites,
        leading = {
          Surface(shape = MaterialTheme.shapes.medium, color = MaterialTheme.colorScheme.tertiaryContainer, modifier = Modifier.size(56.dp)) {
            Box(contentAlignment = Alignment.Center) {
              Icon(painterResource(R.drawable.ic_favorite_filled), contentDescription = null, tint = MaterialTheme.colorScheme.onTertiaryContainer)
            }
          }
        },
      )
    }
    item(key = "new") {
      LibraryRow(
        title = "新增播放清單",
        supporting = null,
        onClick = { naming = true },
        leading = {
          Surface(shape = MaterialTheme.shapes.medium, color = MaterialTheme.colorScheme.surfaceContainerHigh, modifier = Modifier.size(56.dp)) {
            Box(contentAlignment = Alignment.Center) { Icon(painterResource(R.drawable.ic_add), contentDescription = null) }
          }
        },
      )
    }
    items(playlists, key = { it.id }) { playlist ->
      LibraryRow(
        title = playlist.name,
        supporting = "${playlist.trackCount} 首歌",
        onClick = { onOpenPlaylist(playlist.id) },
        leading = { Artwork(artworkUrl(baseUrl, playlist.artworkId), Modifier.size(56.dp), MaterialTheme.shapes.medium, R.drawable.ic_playlist) },
      )
    }
    if (playlists.isEmpty()) {
      item(key = "empty") {
        Text(
          "還沒有播放清單。",
          style = MaterialTheme.typography.bodyMedium,
          color = MaterialTheme.colorScheme.onSurfaceVariant,
          modifier = Modifier.padding(horizontal = 20.dp, vertical = 16.dp),
        )
      }
    }
  }
}

@Composable
private fun LibraryRow(title: String, supporting: String?, onClick: () -> Unit, leading: @Composable () -> Unit) {
  ListItem(
    onClick = onClick,
    leadingContent = leading,
    supportingContent = supporting?.let { { Text(it) } },
    colors = ListItemDefaults.colors(containerColor = Color.Transparent),
    // Lines the artwork up with the page title and the other lists' 20 dp edge.
    contentPadding = PaddingValues(horizontal = 20.dp, vertical = 8.dp),
  ) {
    Text(title, maxLines = 1, overflow = TextOverflow.Ellipsis)
  }
}
