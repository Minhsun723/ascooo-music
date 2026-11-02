package com.ascooo.android.music.ui.collection

import androidx.annotation.DrawableRes
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.RowScope
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.itemsIndexed
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.IconButtonDefaults
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.TopAppBarDefaults
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Shape
import androidx.compose.ui.input.nestedscroll.nestedScroll
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.lifecycle.ViewModel
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewModelScope
import androidx.lifecycle.viewmodel.compose.viewModel
import com.ascooo.android.music.R
import com.ascooo.android.music.appContainer
import com.ascooo.android.music.data.AscoooApi
import com.ascooo.android.music.data.Playlist
import com.ascooo.android.music.data.Track
import com.ascooo.android.music.playback.artworkUrl
import com.ascooo.android.music.ui.components.CollectionHeader
import com.ascooo.android.music.ui.components.DetailTopBar
import com.ascooo.android.music.ui.components.ErrorPane
import com.ascooo.android.music.ui.components.Load
import com.ascooo.android.music.ui.components.LoadingPane
import com.ascooo.android.music.ui.components.PlaylistNameDialog
import com.ascooo.android.music.ui.components.TrackRow
import com.ascooo.android.music.ui.components.loadOf
import java.time.Instant
import java.time.ZoneId
import java.time.format.DateTimeFormatter
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.launch

/** What a page of songs shows above its list. */
data class TrackCollection(
  val title: String,
  val meta: String,
  val tracks: List<Track>,
  val artworkId: String? = null,
  val subtitle: String? = null,
)

class TrackCollectionViewModel(private val fetch: suspend () -> TrackCollection, private var revision: Int) : ViewModel() {
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

  /** Reloads in place, keeping the list on screen, once what it shows has changed ([revision] moved on). */
  fun sync(revision: Int) {
    if (revision == this.revision) return
    this.revision = revision
    viewModelScope.launch {
      val fresh = loadOf { fetch() }
      if (fresh is Load.Ready || collection !is Load.Ready) collection = fresh
    }
  }
}

@Composable
fun FavoritesScreen(onBack: () -> Unit, onPlay: (List<Track>, Int) -> Unit, currentId: String?, modifier: Modifier = Modifier) {
  TrackCollectionScreen(
    // A heart taken off anywhere, this page's own menus included, takes the song off the list.
    revision = LocalContext.current.appContainer.likes.revision,
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
  val container = LocalContext.current.appContainer
  val scope = rememberCoroutineScope()
  TrackCollectionScreen(
    revision = container.playlists.revision,
    onRemove = { track -> track.entryId?.let { container.playlists.remove(playlistId, it) } },
    actions = { collection ->
      PlaylistMenu(
        name = collection.title,
        onRename = { name -> scope.launch { container.playlists.rename(playlistId, name) } },
        onDelete = { scope.launch { if (container.playlists.delete(Playlist(playlistId, collection.title))) onBack() } },
      )
    },
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

/** Renaming and deleting, behind the top bar's "more" button. Deleting asks first, as on the website. */
@Composable
private fun PlaylistMenu(name: String, onRename: (String) -> Unit, onDelete: () -> Unit) {
  var open by remember { mutableStateOf(false) }
  var renaming by rememberSaveable { mutableStateOf(false) }
  var deleting by rememberSaveable { mutableStateOf(false) }
  Box {
    IconButton(onClick = { open = true }, shapes = IconButtonDefaults.shapes()) {
      Icon(painterResource(R.drawable.ic_more_vert), contentDescription = "「$name」的更多選項")
    }
    DropdownMenu(expanded = open, onDismissRequest = { open = false }) {
      DropdownMenuItem(
        text = { Text("重新命名") },
        leadingIcon = { Icon(painterResource(R.drawable.ic_edit), contentDescription = null) },
        onClick = {
          open = false
          renaming = true
        },
      )
      DropdownMenuItem(
        text = { Text("刪除播放清單", color = MaterialTheme.colorScheme.error) },
        leadingIcon = { Icon(painterResource(R.drawable.ic_delete), contentDescription = null, tint = MaterialTheme.colorScheme.error) },
        onClick = {
          open = false
          deleting = true
        },
      )
    }
  }
  if (renaming) {
    PlaylistNameDialog(
      title = "重新命名播放清單",
      confirmLabel = "儲存",
      initial = name,
      onDismiss = { renaming = false },
      onConfirm = {
        renaming = false
        onRename(it)
      },
    )
  }
  if (deleting) {
    AlertDialog(
      onDismissRequest = { deleting = false },
      icon = { Icon(painterResource(R.drawable.ic_delete), contentDescription = null) },
      title = { Text("刪除「$name」？") },
      text = { Text("播放清單會被永久移除，歌曲本身不會受影響。這個動作無法復原。") },
      confirmButton = {
        TextButton(
          onClick = {
            deleting = false
            onDelete()
          },
          colors = ButtonDefaults.textButtonColors(contentColor = MaterialTheme.colorScheme.error),
        ) {
          Text("刪除")
        }
      },
      dismissButton = { TextButton(onClick = { deleting = false }) { Text("取消") } },
    )
  }
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
  revision: StateFlow<Int>? = null,
  onRemove: ((Track) -> Unit)? = null,
  actions: @Composable RowScope.(TrackCollection) -> Unit = {},
) {
  val container = LocalContext.current.appContainer
  val currentRevision = revision?.collectAsStateWithLifecycle()?.value ?: 0
  val viewModel = viewModel { TrackCollectionViewModel({ fetch(container.api) }, currentRevision) }
  LaunchedEffect(currentRevision) { viewModel.sync(currentRevision) }
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
              onRemove = onRemove?.let { remove -> { remove(track) } },
            )
          }
        }
      }
    }
    val ready = (collection as? Load.Ready)?.data
    DetailTopBar(ready?.title, onBack, scrollBehavior, actions = { ready?.let { actions(it) } })
  }
}
