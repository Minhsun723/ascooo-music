package com.ascooo.android.music.ui.settings

import android.os.Build
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.selection.selectable
import androidx.compose.foundation.selection.selectableGroup
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.Icon
import androidx.compose.material3.ListItem
import androidx.compose.material3.ListItemDefaults
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.RadioButton
import androidx.compose.material3.Surface
import androidx.compose.material3.Switch
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.ascooo.android.music.BuildConfig
import com.ascooo.android.music.R
import com.ascooo.android.music.appContainer
import com.ascooo.android.music.data.LyricsFont
import com.ascooo.android.music.data.User
import com.ascooo.android.music.playback.canDecodeAtmos
import com.ascooo.android.music.ui.components.StatusBarScrim
import com.ascooo.android.music.ui.lyrics.LYRICS_FONT_SAMPLE
import com.ascooo.android.music.ui.lyrics.fontFamily
import com.ascooo.android.music.ui.lyrics.label
import kotlinx.coroutines.launch

@Composable
fun SettingsScreen(user: User?, onOpenLanguage: () -> Unit, onSignOut: () -> Unit, modifier: Modifier = Modifier) {
  val container = LocalContext.current.appContainer
  val dynamicColor by container.settings.dynamicColor.collectAsStateWithLifecycle(initialValue = false)
  val lyricsFont by container.settings.lyricsFont.collectAsStateWithLifecycle(initialValue = LyricsFont.Sans)
  val scope = rememberCoroutineScope()

  Box(modifier.fillMaxSize()) {
    Column(Modifier.fillMaxSize().verticalScroll(rememberScrollState()).statusBarsPadding().padding(bottom = 24.dp)) {
      Text("設定", style = MaterialTheme.typography.headlineMediumEmphasized, modifier = Modifier.padding(start = 20.dp, top = 24.dp, bottom = 8.dp))

      Group("帳號") {
        Item(
          headline = user?.username ?: "已登入",
          supporting = when (user?.role) {
            "admin" -> "管理員"
            null -> "目前離線，無法確認帳號資訊"
            else -> "使用者"
          },
        )
      }

      Group("一般") {
        LanguageItem(onOpenLanguage)
      }

      Group("外觀") {
        SwitchItem(
          headline = "跟隨桌布配色",
          supporting = "使用 Material You 依桌布產生的顏色；關閉時使用 Ascooo 的品牌配色",
          checked = dynamicColor,
          onCheckedChange = { scope.launch { container.settings.setDynamicColor(it) } },
        )
        LyricsFontItem(lyricsFont, onPick = { scope.launch { container.settings.setLyricsFont(it) } })
      }

      Group("播放") {
        Item(
          headline = "杜比全景聲",
          supporting =
            if (canDecodeAtmos) "這台裝置能解碼杜比全景聲，直接播放原始檔"
            else "這台裝置無法解碼杜比全景聲",
        )
      }

      OutlinedButton(
        onClick = onSignOut,
        shapes = ButtonDefaults.shapes(),
        modifier = Modifier.fillMaxWidth().padding(horizontal = 20.dp, vertical = 24.dp),
      ) {
        Icon(painterResource(R.drawable.ic_logout), contentDescription = null, modifier = Modifier.size(ButtonDefaults.IconSize))
        Spacer(Modifier.width(ButtonDefaults.IconSpacing))
        Text("登出")
      }

      Text(
        "版本 ${BuildConfig.VERSION_NAME}" + if (BuildConfig.DEBUG) " · ${container.baseUrl}" else "",
        style = MaterialTheme.typography.bodySmall,
        color = MaterialTheme.colorScheme.onSurfaceVariant,
        modifier = Modifier.padding(horizontal = 20.dp),
      )
    }
    StatusBarScrim()
  }
}

/** A titled block of rows on one rounded container, as in Android's own settings. */
@Composable
internal fun Group(title: String? = null, content: @Composable ColumnScope.() -> Unit) {
  if (title != null) {
    Text(
      title,
      style = MaterialTheme.typography.labelLarge,
      color = MaterialTheme.colorScheme.tertiary,
      modifier = Modifier.padding(start = 32.dp, top = 20.dp, bottom = 8.dp),
    )
  }
  Surface(
    shape = MaterialTheme.shapes.extraLarge,
    color = MaterialTheme.colorScheme.surfaceContainer,
    modifier = Modifier.fillMaxWidth().padding(horizontal = 16.dp),
  ) {
    Column(content = content)
  }
}

@Composable
private fun Item(headline: String, supporting: String) {
  ListItem(
    supportingContent = { Text(supporting) },
    colors = ListItemDefaults.colors(containerColor = Color.Transparent),
  ) {
    Text(headline)
  }
}

/** Shows the language the app is set to; [LanguageScreen] is where it is picked. */
@Composable
private fun LanguageItem(onOpen: () -> Unit) {
  // Per-app languages arrived in Android 13; before that the app can only follow the system.
  if (Build.VERSION.SDK_INT < Build.VERSION_CODES.TIRAMISU) {
    Item(headline = "語言", supporting = "Android 13 以上才能為個別 App 指定語言，目前跟隨系統")
    return
  }
  val chosen by rememberAppLocales()
  ListItem(
    onClick = onOpen,
    supportingContent = { Text(if (chosen.isEmpty) "跟隨系統" else chosen[0].nativeName) },
    colors = ListItemDefaults.colors(containerColor = Color.Transparent),
  ) {
    Text("語言")
  }
}

/** The website's four lyrics typefaces, each choice shown in its own font. */
@Composable
private fun LyricsFontItem(font: LyricsFont, onPick: (LyricsFont) -> Unit) {
  var picking by rememberSaveable { mutableStateOf(false) }
  ListItem(
    onClick = { picking = true },
    supportingContent = { Text(font.label) },
    colors = ListItemDefaults.colors(containerColor = Color.Transparent),
  ) {
    Text("歌詞字型")
  }
  if (!picking) return
  AlertDialog(
    onDismissRequest = { picking = false },
    title = { Text("歌詞字型") },
    text = {
      Column(Modifier.selectableGroup()) {
        for (option in LyricsFont.entries) {
          Row(
            Modifier.fillMaxWidth()
              .clip(MaterialTheme.shapes.medium)
              .selectable(
                selected = option == font,
                role = Role.RadioButton,
                onClick = {
                  onPick(option)
                  picking = false
                },
              )
              .padding(vertical = 8.dp),
            verticalAlignment = Alignment.CenterVertically,
          ) {
            RadioButton(selected = option == font, onClick = null)
            Column(Modifier.padding(start = 16.dp)) {
              Text(option.label, style = MaterialTheme.typography.labelMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
              Text(
                LYRICS_FONT_SAMPLE,
                style = TextStyle(fontFamily = option.fontFamily, fontWeight = FontWeight.Bold, fontSize = 22.sp),
                maxLines = 1,
              )
            }
          }
        }
      }
    },
    confirmButton = { TextButton(onClick = { picking = false }) { Text("關閉") } },
  )
}

/** The whole row toggles, not just the switch. */
@Composable
private fun SwitchItem(headline: String, supporting: String, checked: Boolean, onCheckedChange: (Boolean) -> Unit) {
  ListItem(
    checked = checked,
    onCheckedChange = onCheckedChange,
    supportingContent = { Text(supporting) },
    trailingContent = { Switch(checked = checked, onCheckedChange = null) },
    colors = ListItemDefaults.colors(containerColor = Color.Transparent),
  ) {
    Text(headline)
  }
}
