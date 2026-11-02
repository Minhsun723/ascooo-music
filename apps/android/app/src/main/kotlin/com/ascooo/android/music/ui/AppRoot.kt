package com.ascooo.android.music.ui

import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.fadeOut
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.material3.MaterialTheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.ascooo.android.music.appContainer
import com.ascooo.android.music.data.SessionState
import com.ascooo.android.music.ui.login.LoginScreen
import com.ascooo.android.music.ui.player.PlayerViewModel
import kotlinx.coroutines.launch

/** Signed in or not decides everything: the app is a private library, so there is no guest mode. */
@Composable
fun AppRoot(player: PlayerViewModel) {
  val container = LocalContext.current.appContainer
  val session by container.session.state.collectAsStateWithLifecycle()
  val scope = rememberCoroutineScope()

  LaunchedEffect(Unit) {
    if (container.session.state.value == SessionState.Loading) container.auth.restore()
  }
  // Signed out or expired: stop whatever the old session was streaming.
  LaunchedEffect(session) {
    if (session == SessionState.SignedOut) player.stop()
  }

  var introPlayed by rememberSaveable { mutableStateOf(false) }
  val loading = session == SessionState.Loading

  Box(Modifier.fillMaxSize()) {
    when (val state = session) {
      SessionState.Loading -> {} // the launch intro stays up until this resolves
      SessionState.SignedOut -> LoginScreen()
      is SessionState.SignedIn -> MainShell(state.user, player, onSignOut = { scope.launch { container.auth.signOut() } })
    }
    // On top, so the first screen is already loading underneath while the logo plays.
    AnimatedVisibility(!introPlayed || loading, exit = fadeOut(MaterialTheme.motionScheme.defaultEffectsSpec())) {
      LaunchIntro(played = introPlayed, loading = loading, onPlayed = { introPlayed = true })
    }
  }
}
