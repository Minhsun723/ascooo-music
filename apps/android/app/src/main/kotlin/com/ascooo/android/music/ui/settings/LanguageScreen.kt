package com.ascooo.android.music.ui.settings

import android.app.LocaleConfig
import android.app.LocaleManager
import android.os.Build
import android.os.LocaleList
import androidx.annotation.RequiresApi
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.selection.selectableGroup
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.ListItem
import androidx.compose.material3.ListItemDefaults
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.RadioButton
import androidx.compose.material3.Text
import androidx.compose.material3.TopAppBarDefaults
import androidx.compose.runtime.Composable
import androidx.compose.runtime.MutableState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.input.nestedscroll.nestedScroll
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.LifecycleResumeEffect
import com.ascooo.android.music.ui.components.DetailTopBar
import java.util.Locale

/**
 * Sets the app's language through Android's per-app language API, so the system keeps the choice
 * and its own App languages page agrees with this one.
 */
@RequiresApi(Build.VERSION_CODES.TIRAMISU)
@Composable
fun LanguageScreen(onBack: () -> Unit, modifier: Modifier = Modifier) {
  val context = LocalContext.current
  val localeManager = remember { context.getSystemService(LocaleManager::class.java) }
  // Generated from the res/values-* folders, so a new translation shows up here by itself.
  val supported = remember { LocaleConfig(context).supportedLocales?.let { list -> List(list.size()) { list[it] } }.orEmpty() }
  var chosen by rememberAppLocales()
  val scrollBehavior = TopAppBarDefaults.pinnedScrollBehavior()

  fun choose(locales: LocaleList) {
    // A different language recreates the activity; the saved back stack brings this page back.
    localeManager.applicationLocales = locales
    chosen = locales
  }

  Box(modifier.fillMaxSize().nestedScroll(scrollBehavior.nestedScrollConnection)) {
    Column(
      Modifier.fillMaxSize()
        .verticalScroll(rememberScrollState())
        .statusBarsPadding()
        .padding(top = TopAppBarDefaults.TopAppBarExpandedHeight, bottom = 24.dp),
    ) {
      Text("語言", style = MaterialTheme.typography.headlineMediumEmphasized, modifier = Modifier.padding(start = 20.dp, top = 8.dp, bottom = 16.dp))
      Group {
        Column(Modifier.selectableGroup()) {
          Option(
            headline = "跟隨系統",
            supporting = localeManager.systemLocales[0]?.nativeName,
            selected = chosen.isEmpty,
            onClick = { choose(LocaleList.getEmptyLocaleList()) },
          )
          supported.forEach { locale ->
            Option(
              headline = locale.nativeName,
              supporting = null,
              selected = !chosen.isEmpty && chosen[0] == locale,
              onClick = { choose(LocaleList(locale)) },
            )
          }
        }
      }
    }
    DetailTopBar("語言", onBack, scrollBehavior)
  }
}

/**
 * The language the app is set to, empty while it follows the system. Re-read on every resume, since
 * the system's own App languages page can change it while the app is in the background.
 */
@RequiresApi(Build.VERSION_CODES.TIRAMISU)
@Composable
internal fun rememberAppLocales(): MutableState<LocaleList> {
  val localeManager = LocalContext.current.getSystemService(LocaleManager::class.java)
  val locales = remember { mutableStateOf(localeManager.applicationLocales) }
  LifecycleResumeEffect(localeManager) {
    locales.value = localeManager.applicationLocales
    onPauseOrDispose {}
  }
  return locales
}

/**
 * A language named in itself, as language pickers list them: "English", "日本語". The UI's own
 * language would be the one the resources fell back to, which the configuration doesn't say.
 */
internal val Locale.nativeName: String
  get() = getDisplayName(this)

@Composable
private fun Option(headline: String, supporting: String?, selected: Boolean, onClick: () -> Unit) {
  ListItem(
    selected = selected,
    onClick = onClick,
    leadingContent = { RadioButton(selected = selected, onClick = null) },
    supportingContent = supporting?.let { { Text(it) } },
    colors = ListItemDefaults.colors(containerColor = Color.Transparent),
  ) {
    Text(headline)
  }
}
