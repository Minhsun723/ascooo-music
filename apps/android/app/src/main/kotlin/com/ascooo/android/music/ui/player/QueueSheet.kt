package com.ascooo.android.music.ui.player

import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.lazy.rememberLazyListState
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
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import com.ascooo.android.music.R
import com.ascooo.android.music.ui.components.Artwork

/**
 * The queue in the order it will play, opened at the current track. Tapping a track plays it, and
 * any but the current one can be taken out.
 */
@Composable
fun QueueSheet(state: PlayerUiState, onJump: (Int) -> Unit, onRemove: (Int) -> Unit, onDismiss: () -> Unit) {
  val current = state.queue.indexOfFirst { it.index == state.currentIndex }.coerceAtLeast(0)
  val listState = rememberLazyListState(initialFirstVisibleItemIndex = current)
  // Open at full height: the list can't scroll the current track further up than the end of the
  // queue allows, so half a sheet could leave it just below the fold.
  ModalBottomSheet(onDismissRequest = onDismiss, sheetState = rememberModalBottomSheetState(skipPartiallyExpanded = true)) {
    Text("播放佇列", style = MaterialTheme.typography.titleLarge, modifier = Modifier.padding(horizontal = 24.dp, vertical = 8.dp))
    LazyColumn(state = listState, contentPadding = PaddingValues(bottom = 24.dp)) {
      items(state.queue, key = { it.index }) { entry ->
        val playing = entry.index == state.currentIndex
        ListItem(
          onClick = { onJump(entry.index) },
          leadingContent = { Artwork(entry.thumbnail, Modifier.size(48.dp), MaterialTheme.shapes.small) },
          overlineContent = if (playing) { { Text("正在播放", color = MaterialTheme.colorScheme.primary) } } else null,
          supportingContent = { Text(entry.artist, maxLines = 1, overflow = TextOverflow.Ellipsis) },
          trailingContent =
            if (playing) null
            else {
              {
                IconButton(onClick = { onRemove(entry.index) }, shapes = IconButtonDefaults.shapes()) {
                  Icon(painterResource(R.drawable.ic_close), contentDescription = "從佇列移除 ${entry.title}")
                }
              }
            },
          colors = ListItemDefaults.colors(containerColor = Color.Transparent),
        ) {
          Text(entry.title, maxLines = 1, overflow = TextOverflow.Ellipsis)
        }
      }
    }
  }
}
