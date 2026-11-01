package com.ascooo.android.music.ui.settings

import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.Icon
import androidx.compose.material3.ListItem
import androidx.compose.material3.ListItemDefaults
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Surface
import androidx.compose.material3.Switch
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.ascooo.android.music.BuildConfig
import com.ascooo.android.music.R
import com.ascooo.android.music.appContainer
import com.ascooo.android.music.data.User
import com.ascooo.android.music.playback.canDecodeAtmos
import com.ascooo.android.music.ui.components.StatusBarScrim
import kotlinx.coroutines.launch

@Composable
fun SettingsScreen(user: User?, onSignOut: () -> Unit, modifier: Modifier = Modifier) {
  val container = LocalContext.current.appContainer
  val dynamicColor by container.settings.dynamicColor.collectAsStateWithLifecycle(initialValue = false)
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

      Group("外觀") {
        SwitchItem(
          headline = "跟隨桌布配色",
          supporting = "使用 Material You 依桌布產生的顏色；關閉時使用 Ascooo 的品牌配色",
          checked = dynamicColor,
          onCheckedChange = { scope.launch { container.settings.setDynamicColor(it) } },
        )
      }

      Group("播放") {
        Item(
          headline = "杜比全景聲",
          supporting =
            if (canDecodeAtmos) "這台裝置能解碼杜比全景聲，直接播放原始檔"
            else "這台裝置無法解碼杜比全景聲，有 AAC 5.1 版本時改播該版本",
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
private fun Group(title: String, content: @Composable ColumnScope.() -> Unit) {
  Text(
    title,
    style = MaterialTheme.typography.labelLarge,
    color = MaterialTheme.colorScheme.tertiary,
    modifier = Modifier.padding(start = 32.dp, top = 20.dp, bottom = 8.dp),
  )
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
