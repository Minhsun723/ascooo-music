-- Large embedded artwork stays in the original PikPak audio file. D1 stores
-- only a byte-range locator because a D1 row/BLOB is limited to 2 MB.
CREATE TABLE artwork_sources (
  id          TEXT PRIMARY KEY,
  mime        TEXT NOT NULL,
  path        TEXT NOT NULL,
  byte_start  INTEGER NOT NULL,
  byte_length INTEGER NOT NULL
);

-- Only retry tracks that still have no usable track or album artwork.
UPDATE tracks
SET status = 'pending'
WHERE artwork_id IS NULL
  AND NOT EXISTS (
    SELECT 1 FROM albums
    WHERE albums.id = tracks.album_id AND albums.artwork_id IS NOT NULL
  );
