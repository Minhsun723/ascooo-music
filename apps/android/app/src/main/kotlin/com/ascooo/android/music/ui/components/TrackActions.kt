package com.ascooo.android.music.ui.components

import androidx.annotation.DrawableRes
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.IconButtonDefaults
import androidx.compose.material3.ListItem
import androidx.compose.material3.ListItemDefaults
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.Text
import androidx.compose.material3.rememberModalBottomSheetState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.runtime.staticCompositionLocalOf
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.ascooo.android.music.R
import com.ascooo.android.music.appContainer
import com.ascooo.android.music.data.ArtistCredit
import com.ascooo.android.music.data.Track
import com.ascooo.android.music.data.userMessage
import com.ascooo.android.music.playback.artworkUrl
import java.io.IOException
import kotlinx.coroutines.launch
import retrofit2.HttpException

/** What a track's menu can do besides the track itself, provided once by MainShell. */
data class TrackActions(
  val playNext: (Track) -> Unit,
  val addToQueue: (Track) -> Unit,
  val openAlbum: (Long) -> Unit,
  val openArtist: (Long) -> Unit,
  /** The album or artist page the list is on; the menu doesn't offer to go where you already are. */
  val albumHere: Long? = null,
  val artistHere: Long? = null,
)

val LocalTrackActions = staticCompositionLocalOf<TrackActions?> { null }

/** Marks the album or artist page the track lists in [content] are on. */
@Composable
fun TrackActionsHere(albumId: Long? = null, artistId: Long? = null, content: @Composable () -> Unit) {
  val actions = LocalTrackActions.current
  CompositionLocalProvider(LocalTrackActions provides actions?.copy(albumHere = albumId, artistHere = artistId), content = content)
}

/** A track row's "more" button and the sheet it opens. [onRemove] adds "從清單移除", for a playlist's own tracks. */
@Composable
fun TrackMenuButton(track: Track, onRemove: (() -> Unit)? = null) {
  if (LocalTrackActions.current == null) return
  var open by rememberSaveable { mutableStateOf(false) }
  IconButton(onClick = { open = true }, shapes = IconButtonDefaults.shapes()) {
    Icon(painterResource(R.drawable.ic_more_vert), contentDescription = "${track.title} 的更多選項")
  }
  if (open) TrackSheet(track, onRemove, onDismiss = { open = false })
}

/** The website's track menu as a sheet: queueing, the heart, links to the album and artists, and playlists. */
@Composable
private fun TrackSheet(track: Track, onRemove: (() -> Unit)?, onDismiss: () -> Unit) {
  val actions = LocalTrackActions.current ?: return
  val container = LocalContext.current.appContainer
  val sheetState = rememberModalBottomSheetState()
  val scope = rememberCoroutineScope()
  val playlists by container.playlists.playlists.collectAsStateWithLifecycle()
  val overrides by container.likes.overrides.collectAsStateWithLifecycle()
  val liked = overrides[track.id] ?: track.liked
  var naming by rememberSaveable { mutableStateOf(false) }

  LaunchedEffect(Unit) {
    if (playlists == null) {
      try {
        container.playlists.refresh()
      } catch (e: IOException) {
        container.notices.post(e.userMessage())
      } catch (e: HttpException) {
        container.notices.post(e.userMessage())
      }
    }
  }

  // The sheet slides away first, so a page opened by the action isn't covered by it on the way in.
  fun act(action: () -> Unit) {
    scope.launch { sheetState.hide() }.invokeOnCompletion {
      onDismiss()
      action()
    }
  }

  val credits = track.artists.ifEmpty { listOfNotNull(track.artistId?.let { ArtistCredit(it, track.artist) }) }
  val artistLinks = credits.filter { it.id != actions.artistHere }

  ModalBottomSheet(onDismissRequest = onDismiss, sheetState = sheetState) {
    ListItem(
      leadingContent = { Artwork(artworkUrl(container.baseUrl, track.artworkId), Modifier.size(56.dp), MaterialTheme.shapes.medium) },
      supportingContent = { Text(track.artist, maxLines = 1, overflow = TextOverflow.Ellipsis) },
      colors = ListItemDefaults.colors(containerColor = Color.Transparent),
    ) {
      Text(track.title, style = MaterialTheme.typography.titleMedium, maxLines = 2, overflow = TextOverflow.Ellipsis)
    }
    HorizontalDivider(Modifier.padding(horizontal = 16.dp, vertical = 4.dp))
    LazyColumn(contentPadding = PaddingValues(bottom = 16.dp)) {
      item {
        Action(R.drawable.ic_queue_play_next, "下一首播放") {
          act {
            actions.playNext(track)
            container.notices.post("下一首播放")
          }
        }
        Action(R.drawable.ic_queue_music, "加入播放佇列") {
          act {
            actions.addToQueue(track)
            container.notices.post("已加入佇列")
          }
        }
        Action(
          if (liked) R.drawable.ic_favorite_filled else R.drawable.ic_favorite,
          if (liked) "從喜愛的歌曲移除" else "加入喜愛的歌曲",
        ) {
          act { container.likes.toggle(track.id, liked) }
        }
        track.albumId?.takeIf { it != actions.albumHere }?.let { album -> Action(R.drawable.ic_album, "前往專輯") { act { actions.openAlbum(album) } } }
        artistLinks.forEach { artist ->
          Action(R.drawable.ic_person, if (credits.size > 1) "前往 ${artist.name}" else "前往藝人") { act { actions.openArtist(artist.id) } }
        }
        Text(
          "加入播放清單",
          style = MaterialTheme.typography.labelLarge,
          color = MaterialTheme.colorScheme.primary,
          modifier = Modifier.padding(start = 24.dp, top = 16.dp, bottom = 4.dp),
        )
        Action(R.drawable.ic_add, "新增播放清單") { naming = true }
      }
      items(playlists.orEmpty(), key = { it.id }) { playlist ->
        val added = track.id in playlist.trackIds
        Action(
          if (added) R.drawable.ic_check else R.drawable.ic_playlist_add,
          playlist.name,
          supporting = if (added) "已加入" else null,
          enabled = !added,
        ) {
          act { container.playlists.add(playlist, track.id) }
        }
      }
      if (onRemove != null) {
        item { Action(R.drawable.ic_delete, "從清單移除", danger = true) { act(onRemove) } }
      }
    }
  }

  if (naming) {
    PlaylistNameDialog(
      title = "新增播放清單",
      confirmLabel = "建立",
      onDismiss = { naming = false },
      onConfirm = { name ->
        naming = false
        act { container.scope.launch { container.playlists.create(name, listOf(track.id)) } }
      },
    )
  }
}

@Composable
private fun Action(
  @DrawableRes icon: Int,
  label: String,
  supporting: String? = null,
  enabled: Boolean = true,
  danger: Boolean = false,
  onClick: () -> Unit,
) {
  val tint = if (danger) MaterialTheme.colorScheme.error else Color.Unspecified
  ListItem(
    onClick = onClick,
    enabled = enabled,
    leadingContent = { Icon(painterResource(icon), contentDescription = null, tint = if (danger) tint else MaterialTheme.colorScheme.onSurfaceVariant) },
    supportingContent = supporting?.let { { Text(it) } },
    colors = ListItemDefaults.colors(containerColor = Color.Transparent),
  ) {
    Text(label, color = tint, maxLines = 1, overflow = TextOverflow.Ellipsis)
  }
}
