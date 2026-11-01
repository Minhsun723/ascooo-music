package com.ascooo.android.music.data

import kotlinx.serialization.Serializable

// Mirrors of the Worker's JSON (apps/web/src/api/types.ts). Only the fields the app reads are
// declared; unknown keys are ignored, so the server can keep adding fields.

@Serializable
data class User(val id: Long, val username: String, val role: String = "user")

@Serializable
data class ArtistCredit(val id: Long, val name: String)

@Serializable
data class Track(
  val id: Long,
  val title: String,
  /** The whole credit line, e.g. "Shawn Mendes & Camila Cabello". */
  val artist: String,
  val artists: List<ArtistCredit> = emptyList(),
  val artistId: Long? = null,
  val album: String = "",
  val albumId: Long? = null,
  val trackNo: Int? = null,
  val discNo: Int? = null,
  /** Seconds. */
  val duration: Double = 0.0,
  val codec: String? = null,
  val artworkId: String? = null,
  val hasLyrics: Boolean = false,
  /** An AAC 5.1 copy exists for devices that cannot decode Dolby Atmos. */
  val hasAac51: Boolean = false,
  val liked: Boolean = false,
)

@Serializable
data class Album(
  val id: Long,
  val title: String,
  val year: Int? = null,
  val artworkId: String? = null,
  val artistId: Long? = null,
  val artist: String = "",
  val artists: List<ArtistCredit> = emptyList(),
  val trackCount: Int = 0,
  /** Seconds. */
  val duration: Double = 0.0,
  val genre: String? = null,
  val lossless: Boolean = false,
  val atmos: Boolean = false,
  /** Release day as YYYY-MM-DD. Only on the album detail response. */
  val releaseDate: String? = null,
)

@Serializable
data class LibraryStats(val tracks: Int = 0)

@Serializable
data class HomeData(
  val recentAlbums: List<Album> = emptyList(),
  val recentPlays: List<Track> = emptyList(),
  val randomAlbums: List<Album> = emptyList(),
  val quickPicks: List<Track> = emptyList(),
  val stats: LibraryStats = LibraryStats(),
)

@Serializable
data class AlbumDetail(val album: Album, val tracks: List<Track>, val moreByArtist: List<Album> = emptyList())

/**
 * `client = "app"` makes the Worker return the token itself instead of setting the website's cookie.
 * No default on purpose: kotlinx.serialization leaves out properties still at their default value.
 */
@Serializable
data class LoginRequest(val username: String, val password: String, val client: String)

/** A Worker deployed before the app existed ignores `client` and answers without [token]. */
@Serializable
data class LoginResponse(val user: User, val token: String? = null)

@Serializable
data class AuthStatus(val needsSetup: Boolean = false, val user: User? = null)

@Serializable
data class HistoryRequest(val trackId: Long)
