package com.ascooo.android.music.data

import java.io.IOException
import retrofit2.HttpException

class AuthRepository(private val api: AscoooApi, private val session: SessionStore) {
  /**
   * Resume a saved session at launch. The catalog answers anonymous requests too, so a dead token
   * would not show up as a 401 there; ask the server who the token belongs to instead.
   */
  suspend fun restore() {
    if (session.load() == null) return session.signOut()
    try {
      val user = api.status().user
      if (user != null) session.markSignedIn(user) else session.signOut()
    } catch (e: IOException) {
      session.markSignedIn(null) // offline: keep the token and let the screens report the network
    } catch (e: HttpException) {
      session.markSignedIn(null)
    }
  }

  suspend fun login(username: String, password: String) {
    val response = api.login(LoginRequest(username.trim(), password, client = "app"))
    val token = response.token ?: error("伺服器還不支援 App 登入，請先部署最新版本的後端")
    session.signIn(token, response.user)
  }

  /** The token lives only on this device, so forgetting it is the whole logout. */
  suspend fun signOut() = session.signOut()
}
