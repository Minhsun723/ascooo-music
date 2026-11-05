package com.ascooo.android.music.playback

import android.os.Bundle
import androidx.annotation.OptIn
import androidx.core.net.toUri
import androidx.media3.common.C
import androidx.media3.common.Format
import androidx.media3.common.MediaItem
import androidx.media3.common.MediaMetadata
import androidx.media3.common.MimeTypes
import androidx.media3.common.Tracks
import androidx.media3.common.util.UnstableApi
import androidx.media3.exoplayer.mediacodec.MediaCodecSelector
import androidx.media3.exoplayer.mediacodec.MediaCodecUtil
import com.ascooo.android.music.data.Track

/** Which file plays: the original, or the AAC 5.1 copy made for devices without a Dolby decoder. */
enum class AudioSource {
  Original,
  Aac51,
}

private val DOLBY_ATMOS = setOf("ec-3", "eac3", "e-ac-3")

val Track.isDolbyAtmos: Boolean
  get() = codec?.lowercase() in DOLBY_ATMOS

/** The codecs the server counts as lossless, matched as exactly as it does. */
private val LOSSLESS = setOf("flac", "alac", "wav")

val Track.isLossless: Boolean
  get() = codec in LOSSLESS

/** Lossless past CD quality, as the website draws the line: more than 16 bits or 48 kHz. */
val Track.isHiRes: Boolean
  get() = isLossless && ((bitDepth ?: 16) > 16 || (sampleRate ?: 44100) > 48000)

/**
 * Whether ExoPlayer will find a decoder for the library's Atmos files (E-AC-3 JOC). Media3 is asked
 * directly so the answer matches what the player will do: it falls back to a plain E-AC-3 decoder
 * (the 5.1 bed) everywhere except on Google's phones, whose E-AC-3 decoder cannot take JOC streams.
 * A Pixel therefore plays the AAC 5.1 copy, as Chrome does.
 */
val canDecodeAtmos: Boolean by lazy { hasAtmosDecoder() }

@OptIn(UnstableApi::class)
private fun hasAtmosDecoder(): Boolean =
  runCatching {
      val atmos = Format.Builder().setSampleMimeType(MimeTypes.AUDIO_E_AC3_JOC).build()
      MediaCodecUtil.getDecoderInfosSoftMatch(MediaCodecSelector.DEFAULT, atmos, false, false).isNotEmpty()
    }
    .getOrDefault(false)

fun Track.pickSource(): AudioSource = if (hasAac51 && isDolbyAtmos && !canDecodeAtmos) AudioSource.Aac51 else AudioSource.Original

/**
 * The current item has audio but no track this phone can decode. ExoPlayer then plays on in
 * silence with its clock still running, instead of failing.
 */
val Tracks.audioUnplayable: Boolean
  get() = containsType(C.TRACK_TYPE_AUDIO) && !isTypeSupported(C.TRACK_TYPE_AUDIO)

fun streamUrl(baseUrl: String, trackId: Long, source: AudioSource): String =
  "$baseUrl/api/stream/$trackId" + if (source == AudioSource.Aac51) "?v=aac51" else ""

/**
 * Which file the item streams. Read from its request metadata, which a controller sees too; the URI
 * the service plays it from stays in the service.
 */
val MediaItem.audioSource: AudioSource
  get() = if (requestMetadata.mediaUri?.getQueryParameter("v") == "aac51") AudioSource.Aac51 else AudioSource.Original

/** Covers come in 512 px (lists) and 2000 px (album hero, Now Playing, lock screen). */
fun artworkUrl(baseUrl: String, artworkId: String?, size: Int = 512): String? =
  artworkId?.let { "$baseUrl/api/art/$it/$size?v=1" }

const val EXTRA_HAS_AAC51 = "ascooo.hasAac51"

/** Whether the track was liked when it was queued; hearts changed since live in LikesRepository. */
const val EXTRA_LIKED = "ascooo.liked"

/** The 512 px cover, for lists such as the queue; the metadata's own artwork is the 2000 px one. */
const val EXTRA_THUMBNAIL = "ascooo.thumbnail"

const val EXTRA_HAS_LYRICS = "ascooo.hasLyrics"

/**
 * A Dolby Atmos track. Its lyrics are timed against the stereo master, and the Atmos mix (and the
 * AAC 5.1 copy made from it) can start later, by an offset the TTML gives.
 */
const val EXTRA_ATMOS = "ascooo.atmos"

/**
 * The stream goes in RequestMetadata because a controller's MediaItem reaches the session without
 * its local URI; [PlaybackService] turns it back into the item's URI.
 */
fun Track.toMediaItem(baseUrl: String): MediaItem =
  MediaItem.Builder()
    .setMediaId(id.toString())
    .setRequestMetadata(
      MediaItem.RequestMetadata.Builder().setMediaUri(streamUrl(baseUrl, id, pickSource()).toUri()).build()
    )
    .setMediaMetadata(
      MediaMetadata.Builder()
        .setTitle(title)
        .setArtist(artist)
        .setAlbumTitle(album)
        .setArtworkUri(artworkUrl(baseUrl, artworkId, 2000)?.toUri())
        .setDurationMs((duration * 1000).toLong())
        .setIsPlayable(true)
        .setIsBrowsable(false)
        .setExtras(
          Bundle().apply {
            putBoolean(EXTRA_HAS_AAC51, hasAac51)
            putBoolean(EXTRA_LIKED, liked)
            putString(EXTRA_THUMBNAIL, artworkUrl(baseUrl, artworkId))
            putBoolean(EXTRA_HAS_LYRICS, hasLyrics)
            putBoolean(EXTRA_ATMOS, isDolbyAtmos)
          }
        )
        .build()
    )
    .build()
