package com.ascooo.android.music

import kotlinx.coroutines.flow.MutableSharedFlow
import kotlinx.coroutines.flow.SharedFlow

/** Short notes for the user from anywhere in the app, such as "已加入佇列". MainShell shows them as snackbars. */
class Notices {
  private val messages = MutableSharedFlow<String>(extraBufferCapacity = 8)
  val flow: SharedFlow<String> = messages

  fun post(message: String) {
    messages.tryEmit(message)
  }
}
