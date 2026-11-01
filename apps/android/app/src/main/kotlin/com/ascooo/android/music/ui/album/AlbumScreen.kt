package com.ascooo.android.music.ui.album

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.aspectRatio
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.itemsIndexed
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.FilledTonalButton
import androidx.compose.material3.FilledTonalIconButton
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButtonDefaults
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import androidx.lifecycle.viewmodel.compose.viewModel
import com.ascooo.android.music.R
import com.ascooo.android.music.appContainer
import com.ascooo.android.music.data.AlbumDetail
import com.ascooo.android.music.data.AscoooApi
import com.ascooo.android.music.data.Track
import com.ascooo.android.music.playback.artworkUrl
import com.ascooo.android.music.ui.components.Artwork
import com.ascooo.android.music.ui.components.ErrorPane
import com.ascooo.android.music.ui.components.Load
import com.ascooo.android.music.ui.components.LoadingPane
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
  onPlay: (List<Track>, Int) -> Unit,
  currentId: String?,
  modifier: Modifier = Modifier,
) {
  val container = LocalContext.current.appContainer
  val viewModel = viewModel { AlbumViewModel(container.api, albumId) }
  Box(modifier.fillMaxSize()) {
    when (val album = viewModel.album) {
      Load.Loading -> LoadingPane()
      is Load.Failed -> ErrorPane(album.message, viewModel::load)
      is Load.Ready -> AlbumContent(album.data, container.baseUrl, onPlay, currentId)
    }
    FilledTonalIconButton(
      onClick = onBack,
      shapes = IconButtonDefaults.shapes(),
      modifier = Modifier.statusBarsPadding().padding(start = 12.dp, top = 8.dp),
    ) {
      Icon(painterResource(R.drawable.ic_back), contentDescription = "返回")
    }
  }
}

@Composable
private fun AlbumContent(detail: AlbumDetail, baseUrl: String, onPlay: (List<Track>, Int) -> Unit, currentId: String?) {
  val album = detail.album
  val tracks = detail.tracks
  LazyColumn(Modifier.fillMaxSize(), contentPadding = PaddingValues(bottom = 24.dp)) {
    item {
      Column(
        Modifier.fillMaxWidth().statusBarsPadding().padding(top = 56.dp, start = 24.dp, end = 24.dp, bottom = 12.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
      ) {
        Artwork(
          artworkUrl(baseUrl, album.artworkId, 2000),
          Modifier.fillMaxWidth(0.72f).aspectRatio(1f),
          MaterialTheme.shapes.extraLarge,
        )
        Spacer(Modifier.height(24.dp))
        Text(album.title, style = MaterialTheme.typography.headlineSmallEmphasized, textAlign = TextAlign.Center)
        Text(
          album.artist,
          style = MaterialTheme.typography.titleMedium,
          color = MaterialTheme.colorScheme.tertiary,
          textAlign = TextAlign.Center,
          modifier = Modifier.padding(top = 4.dp),
        )
        Text(
          listOfNotNull(album.year?.toString(), "${tracks.size} 首歌", "${(album.duration / 60).roundToInt()} 分鐘").joinToString(" · "),
          style = MaterialTheme.typography.bodyMedium,
          color = MaterialTheme.colorScheme.onSurfaceVariant,
          modifier = Modifier.padding(top = 4.dp),
        )
        val badges = listOfNotNull("Dolby Atmos".takeIf { album.atmos }, "無損".takeIf { album.lossless })
        if (badges.isNotEmpty()) {
          Row(Modifier.padding(top = 12.dp), horizontalArrangement = Arrangement.spacedBy(8.dp)) { badges.forEach { Badge(it) } }
        }
        Spacer(Modifier.height(20.dp))
        Row(horizontalArrangement = Arrangement.spacedBy(12.dp)) {
          Button(onClick = { onPlay(tracks, 0) }, shapes = ButtonDefaults.shapes(), enabled = tracks.isNotEmpty()) {
            Icon(painterResource(R.drawable.ic_play), contentDescription = null, modifier = Modifier.size(ButtonDefaults.IconSize))
            Spacer(Modifier.width(ButtonDefaults.IconSpacing))
            Text("播放")
          }
          FilledTonalButton(onClick = { onPlay(tracks.shuffled(), 0) }, shapes = ButtonDefaults.shapes(), enabled = tracks.isNotEmpty()) {
            Icon(painterResource(R.drawable.ic_shuffle), contentDescription = null, modifier = Modifier.size(ButtonDefaults.IconSize))
            Spacer(Modifier.width(ButtonDefaults.IconSpacing))
            Text("隨機播放")
          }
        }
      }
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
  }
}

@Composable
private fun Badge(label: String) {
  Surface(shape = MaterialTheme.shapes.small, color = MaterialTheme.colorScheme.surfaceContainerHighest) {
    Text(label, style = MaterialTheme.typography.labelMedium, modifier = Modifier.padding(horizontal = 10.dp, vertical = 4.dp))
  }
}
