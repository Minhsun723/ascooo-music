package com.ascooo.android.music.ui.components

import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.focus.focusRequester
import androidx.compose.ui.text.TextRange
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.input.TextFieldValue

/** Asks for a playlist's name, for making one or renaming it. The server caps names at 100 characters. */
@Composable
fun PlaylistNameDialog(title: String, confirmLabel: String, onDismiss: () -> Unit, onConfirm: (String) -> Unit, initial: String = "") {
  // Renaming starts with the old name selected, so typing replaces it.
  var name by rememberSaveable(stateSaver = TextFieldValue.Saver) { mutableStateOf(TextFieldValue(initial, TextRange(0, initial.length))) }
  val focus = remember { FocusRequester() }
  val submit = { if (name.text.isNotBlank()) onConfirm(name.text.trim()) }
  AlertDialog(
    onDismissRequest = onDismiss,
    title = { Text(title) },
    text = {
      OutlinedTextField(
        value = name,
        onValueChange = { if (it.text.length <= 100) name = it },
        label = { Text("名稱") },
        singleLine = true,
        keyboardOptions = KeyboardOptions(imeAction = ImeAction.Done),
        keyboardActions = KeyboardActions(onDone = { submit() }),
        modifier = Modifier.focusRequester(focus),
      )
    },
    confirmButton = { TextButton(onClick = submit, enabled = name.text.isNotBlank()) { Text(confirmLabel) } },
    dismissButton = { TextButton(onClick = onDismiss) { Text("取消") } },
  )
  LaunchedEffect(Unit) { focus.requestFocus() }
}
