package com.ascooo.android.music.ui.login

import androidx.compose.foundation.Image
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.systemBarsPadding
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.LoadingIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.autofill.ContentType
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalFocusManager
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.semantics.contentType
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.unit.dp
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import androidx.lifecycle.viewmodel.compose.viewModel
import com.ascooo.android.music.R
import com.ascooo.android.music.appContainer
import com.ascooo.android.music.data.AuthRepository
import com.ascooo.android.music.data.userMessage
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.launch

class LoginViewModel(private val auth: AuthRepository) : ViewModel() {
  var username by mutableStateOf("")
  var password by mutableStateOf("")
  var busy by mutableStateOf(false)
    private set

  var error by mutableStateOf<String?>(null)
    private set

  fun submit() {
    if (busy || username.isBlank() || password.isEmpty()) return
    busy = true
    error = null
    viewModelScope.launch {
      try {
        auth.login(username, password) // success switches the whole app over to the signed-in shell
      } catch (e: CancellationException) {
        throw e
      } catch (e: Exception) {
        error = e.userMessage()
      } finally {
        busy = false
      }
    }
  }
}

@Composable
fun LoginScreen(modifier: Modifier = Modifier) {
  val container = LocalContext.current.appContainer
  val viewModel = viewModel { LoginViewModel(container.auth) }
  val focus = LocalFocusManager.current

  Column(
    modifier.fillMaxSize().systemBarsPadding().imePadding().padding(horizontal = 28.dp),
    verticalArrangement = Arrangement.Center,
    horizontalAlignment = Alignment.CenterHorizontally,
  ) {
    Column(Modifier.widthIn(max = 420.dp), horizontalAlignment = Alignment.CenterHorizontally) {
      Image(painterResource(R.drawable.brand_logo), contentDescription = "Ascooo Music", modifier = Modifier.height(64.dp))
      Spacer(Modifier.height(28.dp))
      Text("登入以收聽你的音樂庫", style = MaterialTheme.typography.titleMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
      Spacer(Modifier.height(24.dp))
      OutlinedTextField(
        value = viewModel.username,
        onValueChange = { viewModel.username = it },
        label = { Text("使用者名稱") },
        singleLine = true,
        keyboardOptions = KeyboardOptions(autoCorrectEnabled = false, keyboardType = KeyboardType.Ascii, imeAction = ImeAction.Next),
        modifier = Modifier.fillMaxWidth().semantics { contentType = ContentType.Username },
      )
      Spacer(Modifier.height(12.dp))
      OutlinedTextField(
        value = viewModel.password,
        onValueChange = { viewModel.password = it },
        label = { Text("密碼") },
        singleLine = true,
        visualTransformation = PasswordVisualTransformation(),
        keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Password, imeAction = ImeAction.Done),
        keyboardActions =
          KeyboardActions(
            onDone = {
              focus.clearFocus()
              viewModel.submit()
            }
          ),
        modifier = Modifier.fillMaxWidth().semantics { contentType = ContentType.Password },
      )
      viewModel.error?.let {
        Text(
          it,
          style = MaterialTheme.typography.bodyMedium,
          color = MaterialTheme.colorScheme.error,
          modifier = Modifier.fillMaxWidth().padding(top = 12.dp),
        )
      }
      Spacer(Modifier.height(24.dp))
      Button(
        onClick = {
          focus.clearFocus()
          viewModel.submit()
        },
        enabled = !viewModel.busy,
        shapes = ButtonDefaults.shapes(),
        modifier = Modifier.fillMaxWidth().height(56.dp),
      ) {
        if (viewModel.busy) LoadingIndicator(Modifier.size(28.dp), color = MaterialTheme.colorScheme.onSurface)
        else Text("登入", style = MaterialTheme.typography.titleMedium)
      }
    }
  }
}
