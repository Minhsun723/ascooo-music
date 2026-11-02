package com.ascooo.android.music.ui.components

import androidx.compose.material3.Icon
import androidx.compose.material3.IconButtonDefaults
import androidx.compose.material3.IconToggleButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.painterResource
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.ascooo.android.music.R
import com.ascooo.android.music.appContainer

/** A track's heart: [likedAsLoaded] unless it was changed on this device since, and it flips at once when tapped. */
@Composable
fun LikeButton(trackId: Long, likedAsLoaded: Boolean, modifier: Modifier = Modifier) {
  val likes = LocalContext.current.appContainer.likes
  val overrides by likes.overrides.collectAsStateWithLifecycle()
  val liked = overrides[trackId] ?: likedAsLoaded
  IconToggleButton(
    checked = liked,
    onCheckedChange = { likes.toggle(trackId, liked) },
    shapes = IconButtonDefaults.toggleableShapes(),
    modifier = modifier,
  ) {
    Icon(
      painterResource(if (liked) R.drawable.ic_favorite_filled else R.drawable.ic_favorite),
      contentDescription = if (liked) "從喜愛的歌曲移除" else "加入喜愛的歌曲",
    )
  }
}
