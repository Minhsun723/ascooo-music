package com.ascooo.android.music.ui

import android.os.Build
import androidx.activity.compose.BackHandler
import androidx.annotation.DrawableRes
import androidx.compose.animation.AnimatedContentTransitionScope
import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.ContentTransform
import androidx.compose.animation.EnterExitState
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.slideInHorizontally
import androidx.compose.animation.slideInVertically
import androidx.compose.animation.slideOutHorizontally
import androidx.compose.animation.slideOutVertically
import androidx.compose.animation.togetherWith
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.consumeWindowInsets
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Scaffold
import androidx.compose.material3.ShortNavigationBar
import androidx.compose.material3.ShortNavigationBarItem
import androidx.compose.material3.SnackbarHost
import androidx.compose.material3.SnackbarHostState
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.key
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.layout.onSizeChanged
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.unit.IntOffset
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewmodel.navigation3.rememberViewModelStoreNavEntryDecorator
import androidx.navigation3.runtime.NavEntry
import androidx.navigation3.runtime.NavKey
import androidx.navigation3.runtime.entryProvider
import androidx.navigation3.runtime.rememberDecoratedNavEntries
import androidx.navigation3.runtime.rememberNavBackStack
import androidx.navigation3.runtime.rememberSaveableStateHolderNavEntryDecorator
import androidx.navigation3.scene.Scene
import androidx.navigation3.ui.LocalNavAnimatedContentScope
import androidx.navigation3.ui.NavDisplay
import com.ascooo.android.music.R
import com.ascooo.android.music.appContainer
import com.ascooo.android.music.data.Track
import com.ascooo.android.music.data.User
import com.ascooo.android.music.ui.album.AlbumScreen
import com.ascooo.android.music.ui.artist.ArtistScreen
import com.ascooo.android.music.ui.collection.ArtistTracksScreen
import com.ascooo.android.music.ui.collection.FavoritesScreen
import com.ascooo.android.music.ui.collection.PlaylistScreen
import com.ascooo.android.music.ui.components.LocalTrackActions
import com.ascooo.android.music.ui.components.TrackActions
import com.ascooo.android.music.ui.components.TrackActionsHere
import com.ascooo.android.music.ui.components.passTouchesThrough
import com.ascooo.android.music.ui.home.HomeScreen
import com.ascooo.android.music.ui.library.LibraryScreen
import com.ascooo.android.music.ui.player.MiniPlayer
import com.ascooo.android.music.ui.player.NowPlayingScreen
import com.ascooo.android.music.ui.player.PlayerViewModel
import com.ascooo.android.music.ui.search.SearchScreen
import com.ascooo.android.music.ui.settings.LanguageScreen
import com.ascooo.android.music.ui.settings.SettingsScreen
import com.ascooo.android.music.ui.theme.coverColors
import kotlinx.serialization.Serializable

@Serializable data object HomeRoute : NavKey

@Serializable data object SearchRoute : NavKey

@Serializable data object LibraryRoute : NavKey

@Serializable data object SettingsRoute : NavKey

@Serializable data class AlbumRoute(val id: Long) : NavKey

@Serializable data class ArtistRoute(val id: Long) : NavKey

@Serializable data class ArtistTracksRoute(val id: Long) : NavKey

@Serializable data class PlaylistRoute(val id: Long) : NavKey

@Serializable data object FavoritesRoute : NavKey

@Serializable data object LanguageRoute : NavKey

/** The same four destinations as the website's mobile tab bar. */
private enum class Tab(val route: NavKey, val label: String, @DrawableRes val icon: Int, @DrawableRes val selectedIcon: Int) {
  Home(HomeRoute, "首頁", R.drawable.ic_home, R.drawable.ic_home_filled),
  Search(SearchRoute, "搜尋", R.drawable.ic_search, R.drawable.ic_search),
  Library(LibraryRoute, "音樂庫", R.drawable.ic_library_music, R.drawable.ic_library_music_filled),
  Settings(SettingsRoute, "設定", R.drawable.ic_settings, R.drawable.ic_settings_filled),
}

private const val TAB_METADATA = "ascooo.tab"

@Composable
fun MainShell(user: User?, player: PlayerViewModel, onSignOut: () -> Unit) {
  // Each tab keeps its own history, so leaving a tab and coming back finds it as it was.
  val stacks = Tab.entries.associateWith { rememberNavBackStack(it.route) }
  var tab by rememberSaveable { mutableStateOf(Tab.Home) }
  val playerState by player.state.collectAsStateWithLifecycle()
  var nowPlayingOpen by rememberSaveable { mutableStateOf(false) }
  // Each opening gets a fresh Now Playing, so reopening one that is still sliding away after a
  // swipe down doesn't bring back the page pulled off-screen.
  var nowPlayingOpenings by remember { mutableIntStateOf(0) }
  // Out here, so Now Playing opens again on the lyrics if it was closed on them.
  var lyricsShown by rememberSaveable { mutableStateOf(false) }
  // Works out each new cover's colours while Now Playing is closed, so it opens already in them.
  val context = LocalContext.current
  val artworkUrl = playerState.nowPlaying?.artworkUri?.toString()
  LaunchedEffect(artworkUrl) { artworkUrl?.let { coverColors(context, it) } }
  val snackbars = remember { SnackbarHostState() }
  LaunchedEffect(Unit) { context.appContainer.notices.flow.collect { snackbars.showSnackbar(it) } }
  var bottomBarHeight by remember { mutableIntStateOf(0) }
  val currentId = playerState.nowPlaying?.mediaId
  val play: (List<Track>, Int) -> Unit = { tracks, index -> player.play(tracks, index) }

  // Opening a page already in this tab's history goes back to it rather than stacking a copy.
  fun open(route: NavKey) {
    val stack = stacks.getValue(tab)
    val at = stack.indexOf(route)
    if (at < 0) stack.add(route) else while (stack.lastIndex > at) stack.removeAt(stack.lastIndex)
  }
  fun back() {
    val stack = stacks.getValue(tab)
    if (stack.size > 1) stack.removeAt(stack.lastIndex)
  }
  val openAlbum: (Long) -> Unit = { open(AlbumRoute(it)) }
  val openArtist: (Long) -> Unit = { open(ArtistRoute(it)) }

  val provider =
    entryProvider<NavKey> {
      entry<HomeRoute> { HomeScreen(onOpenAlbum = openAlbum, onPlay = play, currentId = currentId) }
      entry<SearchRoute> { SearchScreen(openAlbum, openArtist, play, currentId) }
      entry<LibraryRoute> {
        LibraryScreen(
          onOpenAlbum = openAlbum,
          onOpenArtist = openArtist,
          onOpenPlaylist = { open(PlaylistRoute(it)) },
          onOpenFavorites = { open(FavoritesRoute) },
          onPlay = play,
          currentId = currentId,
        )
      }
      entry<SettingsRoute> { SettingsScreen(user, onOpenLanguage = { open(LanguageRoute) }, onSignOut = onSignOut) }
      // Settings only links here on Android 13+, where per-app languages exist.
      entry<LanguageRoute> { if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) LanguageScreen(::back) }
      entry<AlbumRoute> { route -> TrackActionsHere(albumId = route.id) { AlbumScreen(route.id, ::back, openAlbum, openArtist, play, currentId) } }
      entry<ArtistRoute> { route ->
        TrackActionsHere(artistId = route.id) {
          ArtistScreen(route.id, ::back, openAlbum, onOpenAllTracks = { open(ArtistTracksRoute(route.id)) }, onPlay = play, currentId = currentId)
        }
      }
      entry<ArtistTracksRoute> { route -> TrackActionsHere(artistId = route.id) { ArtistTracksScreen(route.id, ::back, play, currentId) } }
      entry<PlaylistRoute> { route -> PlaylistScreen(route.id, ::back, play, currentId) }
      entry<FavoritesRoute> { FavoritesScreen(::back, play, currentId) }
    }

  // Every tab's entries stay decorated while the app runs, keeping their saved state and view
  // models. Content keys carry the tab, so the same album open in two tabs gets two separate states.
  val entries =
    Tab.entries.associateWith { owner ->
      rememberDecoratedNavEntries(
        backStack = stacks.getValue(owner),
        entryDecorators = listOf(rememberSaveableStateHolderNavEntryDecorator(), rememberViewModelStoreNavEntryDecorator()),
        entryProvider = { key ->
          val entry = provider(key)
          NavEntry(key, "${owner.name}/${entry.contentKey}", entry.metadata + (TAB_METADATA to owner.name)) {
            // Taps go to the page being navigated to, never to one fading out over it.
            val leaving = LocalNavAnimatedContentScope.current.transition.targetState == EnterExitState.PostExit
            Box(Modifier.passTouchesThrough(leaving)) { entry.Content() }
          }
        },
      )
    }

  val spatial = MaterialTheme.motionScheme.defaultSpatialSpec<IntOffset>()
  val effects = MaterialTheme.motionScheme.defaultEffectsSpec<Float>()
  val fastEffects = MaterialTheme.motionScheme.fastEffectsSpec<Float>()
  // Pages within a tab slide along the x axis; switching tabs fades through, as Material specifies.
  fun AnimatedContentTransitionScope<Scene<NavKey>>.transition(forward: Boolean): ContentTransform =
    if (initialState.entries.first().metadata[TAB_METADATA] != targetState.entries.first().metadata[TAB_METADATA]) {
      fadeIn(effects) togetherWith fadeOut(fastEffects)
    } else {
      val direction = if (forward) 1 else -1
      (slideInHorizontally(spatial) { direction * it / 5 } + fadeIn(effects)) togetherWith
        (slideOutHorizontally(spatial) { -direction * it / 5 } + fadeOut(fastEffects))
    }

  // Track menus anywhere below queue through the player and open pages in the current tab.
  val trackActions = remember(player) {
    TrackActions(
      playNext = { player.playNext(listOf(it)) },
      addToQueue = { player.addToQueue(listOf(it)) },
      openAlbum = openAlbum,
      openArtist = openArtist,
    )
  }

  CompositionLocalProvider(LocalTrackActions provides trackActions) {
    Box(Modifier.fillMaxSize()) {
      Scaffold(
        containerColor = MaterialTheme.colorScheme.background,
        // Screens pad for the status bar themselves, so album art can run up under it.
        contentWindowInsets = WindowInsets(0),
        bottomBar = {
          Column(Modifier.onSizeChanged { bottomBarHeight = it.height }) {
            MiniPlayer(
              playerState,
              player,
              onOpen = {
                nowPlayingOpen = true
                nowPlayingOpenings++
              },
            )
            ShortNavigationBar {
              Tab.entries.forEach { item ->
                val selected = item == tab
                ShortNavigationBarItem(
                  selected = selected,
                  onClick = {
                    // Tapping the current tab again goes back to its top.
                    if (selected) stacks.getValue(item).let { while (it.size > 1) it.removeAt(it.lastIndex) } else tab = item
                  },
                  icon = { Icon(painterResource(if (selected) item.selectedIcon else item.icon), contentDescription = null) },
                  label = { Text(item.label) },
                )
              }
            }
          }
        },
      ) { padding ->
        NavDisplay(
          entries = entries.getValue(tab),
          // Consumed so a screen's imePadding counts only the part of the keyboard above the bars.
          modifier = Modifier.padding(padding).consumeWindowInsets(padding),
          transitionSpec = { transition(forward = true) },
          popTransitionSpec = { transition(forward = false) },
          predictivePopTransitionSpec = { transition(forward = false) },
          onBack = ::back,
        )
      }

      AnimatedVisibility(
        visible = nowPlayingOpen && playerState.nowPlaying != null,
        enter = slideInVertically(MaterialTheme.motionScheme.defaultSpatialSpec()) { it },
        exit = slideOutVertically(MaterialTheme.motionScheme.fastSpatialSpec()) { it },
      ) {
        key(nowPlayingOpenings) {
          NowPlayingScreen(
            playerState,
            player,
            onCollapse = { nowPlayingOpen = false },
            lyricsShown = lyricsShown,
            onLyricsShownChange = { lyricsShown = it },
            // Closed, it takes no more touches while it slides away; the app under it already does.
            modifier = Modifier.passTouchesThrough(transition.targetState == EnterExitState.PostExit),
          )
        }
      }

      // Above Now Playing too, so a message sent from there isn't hidden under it. Otherwise it sits
      // on the mini player and the tabs, where a Scaffold would put it.
      SnackbarHost(
        snackbars,
        Modifier.align(Alignment.BottomCenter)
          .then(
            if (nowPlayingOpen) Modifier.navigationBarsPadding()
            else Modifier.padding(bottom = with(LocalDensity.current) { bottomBarHeight.toDp() })
          ),
      )
    }
  }
  // Back from the top of another tab returns to Home before leaving the app.
  BackHandler(enabled = tab != Tab.Home && stacks.getValue(tab).size == 1) { tab = Tab.Home }
  BackHandler(enabled = nowPlayingOpen) { nowPlayingOpen = false }
}
