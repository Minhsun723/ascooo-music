package com.ascooo.android.music.ui

import androidx.activity.compose.BackHandler
import androidx.annotation.DrawableRes
import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.slideInVertically
import androidx.compose.animation.slideOutVertically
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Scaffold
import androidx.compose.material3.ShortNavigationBar
import androidx.compose.material3.ShortNavigationBarItem
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.painterResource
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewmodel.navigation3.rememberViewModelStoreNavEntryDecorator
import androidx.navigation3.runtime.NavKey
import androidx.navigation3.runtime.entryProvider
import androidx.navigation3.runtime.rememberNavBackStack
import androidx.navigation3.runtime.rememberSaveableStateHolderNavEntryDecorator
import androidx.navigation3.ui.NavDisplay
import com.ascooo.android.music.R
import com.ascooo.android.music.data.Track
import com.ascooo.android.music.data.User
import com.ascooo.android.music.ui.album.AlbumScreen
import com.ascooo.android.music.ui.components.ComingSoon
import com.ascooo.android.music.ui.home.HomeScreen
import com.ascooo.android.music.ui.player.MiniPlayer
import com.ascooo.android.music.ui.player.NowPlayingScreen
import com.ascooo.android.music.ui.player.PlayerViewModel
import com.ascooo.android.music.ui.settings.SettingsScreen
import kotlinx.serialization.Serializable

@Serializable data object HomeRoute : NavKey

@Serializable data object SearchRoute : NavKey

@Serializable data object LibraryRoute : NavKey

@Serializable data object SettingsRoute : NavKey

@Serializable data class AlbumRoute(val id: Long) : NavKey

/** The same four destinations as the website's mobile tab bar. */
private enum class Tab(val route: NavKey, val label: String, @DrawableRes val icon: Int, @DrawableRes val selectedIcon: Int) {
  Home(HomeRoute, "首頁", R.drawable.ic_home, R.drawable.ic_home_filled),
  Search(SearchRoute, "搜尋", R.drawable.ic_search, R.drawable.ic_search),
  Library(LibraryRoute, "音樂庫", R.drawable.ic_library_music, R.drawable.ic_library_music_filled),
  Settings(SettingsRoute, "設定", R.drawable.ic_settings, R.drawable.ic_settings_filled),
}

@Composable
fun MainShell(user: User?, player: PlayerViewModel, onSignOut: () -> Unit) {
  val backStack = rememberNavBackStack(HomeRoute)
  val playerState by player.state.collectAsStateWithLifecycle()
  var nowPlayingOpen by rememberSaveable { mutableStateOf(false) }
  val currentId = playerState.nowPlaying?.mediaId
  val play: (List<Track>, Int) -> Unit = { tracks, index -> player.play(tracks, index) }

  Box(Modifier.fillMaxSize()) {
    Scaffold(
      containerColor = MaterialTheme.colorScheme.background,
      // Screens pad for the status bar themselves, so album art can run up under it.
      contentWindowInsets = WindowInsets(0),
      bottomBar = {
        Column {
          MiniPlayer(playerState, player, onOpen = { nowPlayingOpen = true })
          ShortNavigationBar {
            val root = backStack.firstOrNull()
            Tab.entries.forEach { tab ->
              val selected = root == tab.route
              ShortNavigationBarItem(
                selected = selected,
                onClick = {
                  // Tapping a tab, even the current one, goes back to its top.
                  if (!selected || backStack.size > 1) {
                    backStack.clear()
                    backStack.add(tab.route)
                  }
                },
                icon = { Icon(painterResource(if (selected) tab.selectedIcon else tab.icon), contentDescription = null) },
                label = { Text(tab.label) },
              )
            }
          }
        }
      },
    ) { padding ->
      NavDisplay(
        backStack = backStack,
        onBack = { backStack.removeLastOrNull() },
        modifier = Modifier.padding(padding),
        entryDecorators = listOf(rememberSaveableStateHolderNavEntryDecorator(), rememberViewModelStoreNavEntryDecorator()),
        entryProvider =
          entryProvider {
            entry<HomeRoute> { HomeScreen(onOpenAlbum = { backStack.add(AlbumRoute(it)) }, onPlay = play, currentId = currentId) }
            entry<SearchRoute> { ComingSoon("搜尋") }
            entry<LibraryRoute> { ComingSoon("音樂庫") }
            entry<SettingsRoute> { SettingsScreen(user, onSignOut) }
            entry<AlbumRoute> { route ->
              AlbumScreen(route.id, onBack = { backStack.removeLastOrNull() }, onPlay = play, currentId = currentId)
            }
          },
      )
    }

    AnimatedVisibility(
      visible = nowPlayingOpen && playerState.nowPlaying != null,
      enter = slideInVertically(MaterialTheme.motionScheme.defaultSpatialSpec()) { it },
      exit = slideOutVertically(MaterialTheme.motionScheme.fastSpatialSpec()) { it },
    ) {
      NowPlayingScreen(playerState, player, onCollapse = { nowPlayingOpen = false })
    }
  }
  BackHandler(enabled = nowPlayingOpen) { nowPlayingOpen = false }
}
