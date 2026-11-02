package com.ascooo.android.music.data

import com.ascooo.android.music.Notices
import java.io.IOException
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import retrofit2.HttpException

/**
 * Hearts changed on this device, laid over the `liked` flag each track arrives with, like the
 * website's likes store: a heart flips at once and flips back if the server refuses. Requests run
 * on the app's scope, so closing the screen that sent one doesn't cancel it.
 */
class LikesRepository(private val api: AscoooApi, private val scope: CoroutineScope, private val notices: Notices) {
  private val changed = MutableStateFlow<Map<Long, Boolean>>(emptyMap())
  val overrides: StateFlow<Map<Long, Boolean>> = changed.asStateFlow()

  private val confirmed = MutableStateFlow(0)
  /** Bumped once the server has taken a change, for the favorites page to reload on. */
  val revision: StateFlow<Int> = confirmed.asStateFlow()

  fun toggle(trackId: Long, liked: Boolean) {
    changed.update { it + (trackId to !liked) }
    scope.launch {
      try {
        if (liked) api.unlike(trackId) else api.like(trackId)
        confirmed.update { it + 1 }
      } catch (e: IOException) {
        undo(trackId, liked, e)
      } catch (e: HttpException) {
        undo(trackId, liked, e)
      }
    }
  }

  private fun undo(trackId: Long, liked: Boolean, error: Throwable) {
    changed.update { it + (trackId to liked) }
    notices.post(error.userMessage())
  }

  /** Another account's hearts mean nothing to the next one. */
  fun reset() {
    changed.value = emptyMap()
  }
}
