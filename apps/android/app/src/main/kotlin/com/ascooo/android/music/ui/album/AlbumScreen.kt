package com.ascooo.android.music.ui.album

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
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
import com.ascooo.android.music.data.Album
import com.ascooo.android.music.data.AlbumDetail
import com.ascooo.android.music.data.AscoooApi
import com.ascooo.android.music.data.Track
import com.ascooo.android.music.playback.artworkUrl
import com.ascooo.android.music.playback.isHiRes
import com.ascooo.android.music.playback.isLossless
import com.ascooo.android.music.ui.components.AlbumShelf
import com.ascooo.android.music.ui.components.CollectionHeader
import com.ascooo.android.music.ui.components.DetailTopBar
import com.ascooo.android.music.ui.components.ErrorPane
import com.ascooo.android.music.ui.components.Load
import com.ascooo.android.music.ui.components.LoadingPane
import com.ascooo.android.music.ui.components.SectionHeader
import com.ascooo.android.music.ui.components.TrackRow
import com.ascooo.android.music.ui.components.formatLongDuration
import com.ascooo.android.music.ui.components.formatReleaseDate
import com.ascooo.android.music.ui.components.loadOf
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
        artists = album.artists,
        onOpenArtist = onOpenArtist,
        meta = listOfNotNull(album.genre?.takeIf { it.isNotBlank() }, album.year?.let { "$it 年" }).joinToString(" · "),
        dolbyAtmos = album.atmos,
        aac51 = album.aac51,
        badges = listOfNotNull(losslessBadge(album, tracks)),
        tracks = tracks,
        onPlay = onPlay,
      )
    }
    itemsIndexed(tracks, key = { _, track -> track.id }) { index, track ->
      TrackRow(
        track,
        artworkUrl = null,
        onClick = { onPlay(tracks, index) },
        // Counted down the list, as on the website, so songs missing from the album leave no gaps.
        number = index + 1,
        current = track.id.toString() == currentId,
      )
    }
    item { AlbumSummary(album) }
    if (detail.moreByArtist.isNotEmpty()) {
      item { SectionHeader("更多 ${leadArtist?.name ?: album.artist}") }
      item { AlbumShelf(detail.moreByArtist, baseUrl, onOpenAlbum) }
    }
  }
}

/**
 * HI-RES when every lossless song on the album is hi-res, otherwise LOSSLESS, the labels the website
 * gives each song. Nothing when no song is lossless.
 */
private fun losslessBadge(album: Album, tracks: List<Track>): String? {
  if (!album.lossless) return null
  val lossless = tracks.filter { it.isLossless }
  return if (lossless.isNotEmpty() && lossless.all { it.isHiRes }) "HI-RES" else "LOSSLESS"
}

/**
 * The website's footer under the songs: the release day (or just the year), how many songs and how
 * long, and the copyright line, or failing that ℗ and the label.
 */
@Composable
private fun AlbumSummary(album: Album) {
  val released = album.releaseDate?.takeIf { it.isNotBlank() }?.let(::formatReleaseDate) ?: album.year?.let { "$it 年" }
  val rights =
    album.copyright?.takeIf { it.isNotBlank() }
      ?: album.recordLabel?.takeIf { it.isNotBlank() }?.let { label -> listOfNotNull("℗", album.year?.toString(), label).joinToString(" ") }
  Column(
    Modifier.fillMaxWidth().padding(start = 20.dp, end = 20.dp, top = 24.dp, bottom = 8.dp),
    verticalArrangement = Arrangement.spacedBy(2.dp),
  ) {
    listOfNotNull(released, "${album.trackCount} 首歌曲 · ${formatLongDuration(album.duration)}", rights).forEach { line ->
      Text(line, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
    }
  }
}
