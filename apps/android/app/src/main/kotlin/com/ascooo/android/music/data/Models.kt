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
  /** Set on a playlist's tracks: which entry of the playlist this is, for removing it. */
  val entryId: Long? = null,
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

/** An artist in lists and search results; [trackCount] is only on the library list. */
@Serializable
data class Artist(val id: Long, val name: String, val artworkId: String? = null, val trackCount: Int = 0)

@Serializable
data class HomeData(
  val recentAlbums: List<Album> = emptyList(),
  val recentPlays: List<Track> = emptyList(),
  val randomAlbums: List<Album> = emptyList(),
  /** Drawn from every visible song, so it is empty exactly when the library is. */
  val quickPicks: List<Track> = emptyList(),
)

@Serializable
data class AlbumDetail(val album: Album, val tracks: List<Track>, val moreByArtist: List<Album> = emptyList())

/** An artist's page: their albums and up to 50 most played songs. */
@Serializable
data class ArtistDetail(val artist: Artist, val albums: List<Album> = emptyList(), val tracks: List<Track> = emptyList())

@Serializable
data class SearchResults(
  val tracks: List<Track> = emptyList(),
  val albums: List<Album> = emptyList(),
  val artists: List<Artist> = emptyList(),
)

@Serializable
data class TrackList(val tracks: List<Track> = emptyList(), val total: Int = 0)

@Serializable
data class AlbumList(val albums: List<Album> = emptyList())

@Serializable
data class ArtistList(val artists: List<Artist> = emptyList())

/** All of one artist's songs, for the artist page's "所有歌曲". */
@Serializable
data class ArtistTracks(val artist: Artist, val tracks: List<Track> = emptyList())

@Serializable
data class Playlist(
  val id: Long,
  val name: String,
  val description: String? = null,
  val trackCount: Int = 0,
  val artworkId: String? = null,
  /** Epoch milliseconds. */
  val updatedAt: Long = 0,
  val trackIds: List<Long> = emptyList(),
)

@Serializable
data class PlaylistList(val playlists: List<Playlist> = emptyList())

@Serializable
data class PlaylistDetail(val playlist: Playlist, val tracks: List<Track> = emptyList())

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

@Serializable
data class LikeResponse(val liked: Boolean)

@Serializable
data class CreatePlaylistRequest(val name: String, val trackIds: List<Long> = emptyList())

@Serializable
data class CreatedPlaylist(val id: Long, val name: String)

@Serializable
data class RenamePlaylistRequest(val name: String)

@Serializable
data class TrackIdsRequest(val trackIds: List<Long>)

@Serializable
data class OkResponse(val ok: Boolean = true)

/** A song's lyrics as stored: LRC or Apple's TTML ([format] `lrc` / `ttml`) when [synced], else plain text. */
@Serializable
data class Lyrics(val content: String, val synced: Boolean = false, val format: String = "lrc")

@Serializable
data class LyricsResponse(val lyrics: Lyrics? = null)
