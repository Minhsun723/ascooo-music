-- Apple Music's artist ID points at the first/primary artist and is shared by
-- some collaboration credits. The stable identity is therefore the ID plus
-- Apple's complete artistName, not the ID alone.
ALTER TABLE artists ADD COLUMN apple_music_name TEXT COLLATE NOCASE;

-- Existing localized aliases already keep Apple's canonical name in
-- display_name. Native-name rows fall back to their original name. A regular
-- local sync refreshes this value from Apple for every enriched track.
UPDATE artists
SET apple_music_name = COALESCE(NULLIF(display_name, ''), name)
WHERE apple_music_id IS NOT NULL;

-- Build an explicit map before changing relationships. The lowest artist ID
-- is retained so existing artist links remain stable whenever possible.
CREATE TABLE _artist_alias_merge (
  artist_id    INTEGER PRIMARY KEY,
  canonical_id INTEGER NOT NULL
);

INSERT INTO _artist_alias_merge (artist_id, canonical_id)
SELECT artist.id,
  (
    SELECT MIN(candidate.id)
    FROM artists candidate
    WHERE candidate.apple_music_id = artist.apple_music_id
      AND candidate.apple_music_name = artist.apple_music_name COLLATE NOCASE
  )
FROM artists artist
WHERE artist.apple_music_id IS NOT NULL
  AND artist.apple_music_name IS NOT NULL
  AND EXISTS (
    SELECT 1
    FROM artists duplicate
    WHERE duplicate.id != artist.id
      AND duplicate.apple_music_id = artist.apple_music_id
      AND duplicate.apple_music_name = artist.apple_music_name COLLATE NOCASE
  );

-- Albums can also collide on UNIQUE(title, artist_id). Map every album in an
-- alias group to one retained album before moving artist relationships.
CREATE TABLE _album_alias_merge (
  album_id          INTEGER PRIMARY KEY,
  canonical_album_id INTEGER NOT NULL
);

INSERT INTO _album_alias_merge (album_id, canonical_album_id)
SELECT album.id,
  (
    SELECT MIN(candidate_album.id)
    FROM albums candidate_album
    JOIN _artist_alias_merge candidate_artist
      ON candidate_artist.artist_id = candidate_album.artist_id
    WHERE candidate_artist.canonical_id = artist_map.canonical_id
      AND candidate_album.title = album.title COLLATE NOCASE
  )
FROM albums album
JOIN _artist_alias_merge artist_map ON artist_map.artist_id = album.artist_id;

-- Preserve useful metadata from any duplicate album before removing it.
UPDATE albums
SET year = COALESCE(
      year,
      (
        SELECT source.year
        FROM albums source
        JOIN _album_alias_merge source_map ON source_map.album_id = source.id
        WHERE source_map.canonical_album_id = albums.id AND source.year IS NOT NULL
        ORDER BY source.id
        LIMIT 1
      )
    ),
    artwork_id = COALESCE(
      artwork_id,
      (
        SELECT source.artwork_id
        FROM albums source
        JOIN _album_alias_merge source_map ON source_map.album_id = source.id
        WHERE source_map.canonical_album_id = albums.id AND source.artwork_id IS NOT NULL
        ORDER BY source.id
        LIMIT 1
      )
    )
WHERE id IN (SELECT canonical_album_id FROM _album_alias_merge);

UPDATE tracks
SET album_id = (
  SELECT canonical_album_id
  FROM _album_alias_merge
  WHERE album_id = tracks.album_id
)
WHERE album_id IN (
  SELECT album_id
  FROM _album_alias_merge
  WHERE album_id != canonical_album_id
);

DELETE FROM albums
WHERE id IN (
  SELECT album_id
  FROM _album_alias_merge
  WHERE album_id != canonical_album_id
);

UPDATE albums
SET artist_id = (
  SELECT canonical_id
  FROM _artist_alias_merge
  WHERE artist_id = albums.artist_id
)
WHERE artist_id IN (SELECT artist_id FROM _artist_alias_merge);

UPDATE tracks
SET artist_id = (
  SELECT canonical_id
  FROM _artist_alias_merge
  WHERE artist_id = tracks.artist_id
)
WHERE artist_id IN (SELECT artist_id FROM _artist_alias_merge);

-- Preserve localized names and artist artwork on the retained row.
UPDATE artists
SET display_name = COALESCE(
      display_name,
      (
        SELECT source.display_name
        FROM artists source
        JOIN _artist_alias_merge source_map ON source_map.artist_id = source.id
        WHERE source_map.canonical_id = artists.id AND source.display_name IS NOT NULL
        ORDER BY source.id
        LIMIT 1
      )
    ),
    artwork_id = COALESCE(
      artwork_id,
      (
        SELECT source.artwork_id
        FROM artists source
        JOIN _artist_alias_merge source_map ON source_map.artist_id = source.id
        WHERE source_map.canonical_id = artists.id AND source.artwork_id IS NOT NULL
        ORDER BY source.id
        LIMIT 1
      )
    )
WHERE id IN (SELECT canonical_id FROM _artist_alias_merge);

DELETE FROM artists
WHERE id IN (
  SELECT artist_id
  FROM _artist_alias_merge
  WHERE artist_id != canonical_id
);

DROP TABLE _album_alias_merge;
DROP TABLE _artist_alias_merge;

CREATE UNIQUE INDEX idx_artists_apple_music_identity
ON artists(apple_music_id, apple_music_name)
WHERE apple_music_id IS NOT NULL AND apple_music_name IS NOT NULL;
