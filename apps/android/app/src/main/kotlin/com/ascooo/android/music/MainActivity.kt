package com.ascooo.android.music

import android.graphics.Color
import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.SystemBarStyle
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.runtime.getValue
import androidx.compose.ui.Modifier
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewmodel.compose.viewModel
import com.ascooo.android.music.ui.AppRoot
import com.ascooo.android.music.ui.theme.AscoooTheme

class MainActivity : ComponentActivity() {
  override fun onCreate(savedInstanceState: Bundle?) {
    super.onCreate(savedInstanceState)
    // The app is always dark, so the system bars always get light icons.
    enableEdgeToEdge(
      statusBarStyle = SystemBarStyle.dark(Color.TRANSPARENT),
      navigationBarStyle = SystemBarStyle.dark(Color.TRANSPARENT),
    )
    // LaunchIntro's first frame is the splash itself, so drop the splash the moment it is up
    // instead of playing the system's exit animation over it.
    if (savedInstanceState == null) splashScreen.setOnExitAnimationListener { it.remove() }
    setContent {
      val dynamicColor by appContainer.settings.dynamicColor.collectAsStateWithLifecycle(initialValue = false)
      AscoooTheme(dynamicColor) {
        Surface(Modifier.fillMaxSize(), color = MaterialTheme.colorScheme.background) { AppRoot(player = viewModel()) }
      }
    }
  }
}
