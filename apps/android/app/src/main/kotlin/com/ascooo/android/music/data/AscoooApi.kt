package com.ascooo.android.music.data

import java.io.IOException
import kotlinx.serialization.SerializationException
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import retrofit2.HttpException
import retrofit2.http.Body
import retrofit2.http.GET
import retrofit2.http.POST
import retrofit2.http.Path

/** The Worker's `/api` routes the app uses. */
interface AscoooApi {
  @POST("auth/login") suspend fun login(@Body body: LoginRequest): LoginResponse

  @GET("auth/status") suspend fun status(): AuthStatus

  @GET("home") suspend fun home(): HomeData

  @GET("albums/{id}") suspend fun album(@Path("id") id: Long): AlbumDetail

  @POST("me/history") suspend fun history(@Body body: HistoryRequest)
}

/** The Worker answers errors as `{ "error": "..." }` in Traditional Chinese; show that when there is one. */
fun Throwable.userMessage(): String =
  when (this) {
    is HttpException ->
      response()?.errorBody()?.string()?.let { body ->
        runCatching { Json.parseToJsonElement(body).jsonObject["error"]?.jsonPrimitive?.content }.getOrNull()
      } ?: "伺服器發生錯誤（HTTP ${code()}）"
    is IOException -> "無法連線到伺服器，請檢查網路"
    is SerializationException -> "伺服器回應的格式不符，App 或伺服器可能需要更新"
    else -> message ?: "發生錯誤"
  }
