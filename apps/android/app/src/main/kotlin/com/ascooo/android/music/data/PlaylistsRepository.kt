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
 * The signed-in user's playlists, shared by the library and every track menu. Each change made
 * here reloads the list and bumps [revision], which open playlist pages watch to reload themselves.
 * Outcomes are reported through [Notices], so callers only learn whether a change went through.
 */
class PlaylistsRepository(private val api: AscoooApi, private val scope: CoroutineScope, private val notices: Notices) {
  private val list = MutableStateFlow<List<Playlist>?>(null)
  /** Null until first loaded. */
  val playlists: StateFlow<List<Playlist>?> = list.asStateFlow()

  private val changes = MutableStateFlow(0)
  val revision: StateFlow<Int> = changes.asStateFlow()

  /** Throws like any API call, for screens that show their own error. */
  suspend fun refresh() {
    list.value = api.playlists().playlists
  }

  fun add(playlist: Playlist, trackId: Long) {
    scope.launch { change("已加入「${playlist.name}」") { api.addToPlaylist(playlist.id, TrackIdsRequest(listOf(trackId))) } }
  }

  /** The new playlist's id, or null if it couldn't be made. */
  suspend fun create(name: String, trackIds: List<Long> = emptyList()): Long? {
    var id: Long? = null
    val notice = if (trackIds.isEmpty()) "已建立「$name」" else "已建立「$name」並加入這首歌"
    change(notice) { id = api.createPlaylist(CreatePlaylistRequest(name, trackIds)).id }
    return id
  }

  suspend fun rename(id: Long, name: String): Boolean = change("已重新命名為「$name」") { api.renamePlaylist(id, RenamePlaylistRequest(name)) }

  suspend fun delete(playlist: Playlist): Boolean = change("已刪除「${playlist.name}」") { api.deletePlaylist(playlist.id) }

  fun remove(playlistId: Long, entryId: Long) {
    scope.launch { change("已從播放清單移除") { api.removeFromPlaylist(playlistId, entryId) } }
  }

  private suspend fun change(notice: String, request: suspend () -> Unit): Boolean =
    try {
      request()
      changes.update { it + 1 }
      notices.post(notice)
      // The list only feeds counts and checkmarks, so a failed reload can wait for the next change.
      try {
        refresh()
      } catch (_: IOException) {
      } catch (_: HttpException) {
      }
      true
    } catch (e: IOException) {
      notices.post(e.userMessage())
      false
    } catch (e: HttpException) {
      notices.post(e.userMessage())
      false
    }

  /** Another account's playlists mean nothing to the next one. */
  fun reset() {
    list.value = null
  }
}
