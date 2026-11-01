package com.ascooo.android.music.data

import kotlinx.serialization.json.Json
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class ModelsTest {
  // The same settings as AppContainer's converter.
  private val json = Json {
    ignoreUnknownKeys = true
    explicitNulls = false
    coerceInputValues = true
  }

  @Test
  fun loginRequestSendsClient() {
    // Without `client`, the Worker treats the login as the website's and answers with a cookie, not a token.
    val body = json.parseToJsonElement(json.encodeToString(LoginRequest.serializer(), LoginRequest("me", "secret", client = "app")))
    assertEquals("app", body.jsonObject["client"]?.jsonPrimitive?.content)
  }

  @Test
  fun loginResponseFromAnOldWorkerHasNoToken() {
    val response = json.decodeFromString(LoginResponse.serializer(), """{"user":{"id":1,"username":"me","role":"admin"}}""")
    assertNull(response.token)
  }
}
