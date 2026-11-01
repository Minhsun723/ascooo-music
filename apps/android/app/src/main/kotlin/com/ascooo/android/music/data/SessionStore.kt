package com.ascooo.android.music.data

import android.content.Context
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import android.util.Base64
import androidx.datastore.preferences.core.edit
import androidx.datastore.preferences.core.stringPreferencesKey
import androidx.datastore.preferences.preferencesDataStore
import java.security.KeyStore
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.launch

sealed interface SessionState {
  data object Loading : SessionState

  data object SignedOut : SessionState

  /** [user] is null when the token was kept but the server could not be asked who it belongs to (offline). */
  data class SignedIn(val user: User?) : SessionState
}

private val Context.sessionDataStore by preferencesDataStore(name = "session")
private val TOKEN = stringPreferencesKey("token")

/**
 * Holds the Bearer token. It is kept in memory for [AuthInterceptor], which must read it
 * synchronously, and saved encrypted with a key that only this device's keystore holds.
 */
class SessionStore(context: Context, private val scope: CoroutineScope) {
  private val store = context.sessionDataStore
  private val cipher = TokenCipher()
  private val _state = MutableStateFlow<SessionState>(SessionState.Loading)
  val state: StateFlow<SessionState> = _state

  @Volatile
  var token: String? = null
    private set

  /** The token saved by an earlier launch, or null. A token that cannot be decrypted counts as none. */
  suspend fun load(): String? {
    token = store.data.first()[TOKEN]?.let(cipher::decrypt)
    return token
  }

  suspend fun signIn(token: String, user: User) {
    this.token = token
    save(token)
    _state.value = SessionState.SignedIn(user)
  }

  fun markSignedIn(user: User?) {
    _state.value = SessionState.SignedIn(user)
  }

  /** The Worker re-checked the session and sent a fresh token in X-Session-Token. */
  fun renew(token: String) {
    if (this.token == null) return // signed out while the request was in flight
    this.token = token
    scope.launch { save(token) }
  }

  /** The server refused [rejected]; drop it unless a newer token has replaced it meanwhile. */
  fun expire(rejected: String) {
    if (token != rejected) return
    token = null
    _state.value = SessionState.SignedOut
    scope.launch { store.edit { it.remove(TOKEN) } }
  }

  suspend fun signOut() {
    token = null
    store.edit { it.remove(TOKEN) }
    _state.value = SessionState.SignedOut
  }

  private suspend fun save(token: String) {
    store.edit { it[TOKEN] = cipher.encrypt(token) }
  }
}

/** AES-GCM with a non-exportable Android Keystore key; stored values are base64(iv + ciphertext). */
private class TokenCipher {
  private val keyStore = KeyStore.getInstance(KEYSTORE).apply { load(null) }

  private fun key(): SecretKey =
    (keyStore.getEntry(ALIAS, null) as? KeyStore.SecretKeyEntry)?.secretKey
      ?: KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, KEYSTORE)
        .apply {
          init(
            KeyGenParameterSpec.Builder(ALIAS, KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT)
              .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
              .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
              .setKeySize(256)
              .build()
          )
        }
        .generateKey()

  fun encrypt(plain: String): String {
    val cipher = Cipher.getInstance(TRANSFORMATION).apply { init(Cipher.ENCRYPT_MODE, key()) }
    return Base64.encodeToString(cipher.iv + cipher.doFinal(plain.toByteArray()), Base64.NO_WRAP)
  }

  fun decrypt(stored: String): String? =
    runCatching {
        val bytes = Base64.decode(stored, Base64.NO_WRAP)
        val cipher =
          Cipher.getInstance(TRANSFORMATION).apply {
            init(Cipher.DECRYPT_MODE, key(), GCMParameterSpec(128, bytes, 0, IV_BYTES))
          }
        String(cipher.doFinal(bytes, IV_BYTES, bytes.size - IV_BYTES))
      }
      .getOrNull()

  private companion object {
    const val KEYSTORE = "AndroidKeyStore"
    const val ALIAS = "ascooo-session"
    const val TRANSFORMATION = "AES/GCM/NoPadding"
    const val IV_BYTES = 12
  }
}
