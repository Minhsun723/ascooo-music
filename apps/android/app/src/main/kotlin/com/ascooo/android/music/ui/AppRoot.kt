package com.ascooo.android.music.ui

import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.ui.platform.LocalContext
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.ascooo.android.music.appContainer
import com.ascooo.android.music.data.SessionState
import com.ascooo.android.music.ui.components.LoadingPane
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

  when (val state = session) {
    SessionState.Loading -> LoadingPane()
    SessionState.SignedOut -> LoginScreen()
    is SessionState.SignedIn -> MainShell(state.user, player, onSignOut = { scope.launch { container.auth.signOut() } })
  }
}
