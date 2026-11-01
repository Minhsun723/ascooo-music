package com.ascooo.android.music.data

import okhttp3.Interceptor
import okhttp3.Response

/**
 * Signs requests to our own server with the session token. Every client in the app (API calls,
 * audio streams, covers) shares one OkHttpClient, so the host check is what keeps the token from
 * reaching anyone else, such as Apple's CDN for artist motion artwork.
 */
class AuthInterceptor(private val apiHost: String, private val session: SessionStore) : Interceptor {
  override fun intercept(chain: Interceptor.Chain): Response {
    val request = chain.request()
    val token = session.token
    if (request.url.host != apiHost || token == null) return chain.proceed(request)

    val response = chain.proceed(request.newBuilder().header("Authorization", "Bearer $token").build())
    // An hour after it was issued the Worker re-checks the session and hands back a fresh token.
    response.header(SESSION_TOKEN_HEADER)?.let(session::renew)
    // Login answers 401 for a wrong password; anywhere else it means the session is gone.
    if (response.code == 401 && !request.url.encodedPath.startsWith("/api/auth/")) session.expire(token)
    return response
  }

  private companion object {
    const val SESSION_TOKEN_HEADER = "X-Session-Token"
  }
}
