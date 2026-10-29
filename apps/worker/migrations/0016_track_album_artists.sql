-- A song or album can credit several artists ("Shawn Mendes & Camila Cabello").
-- As on Apple Music, each of them lists it on their own page and the combined
-- credit has no page of its own. tracks.artist_id and albums.artist_id stay as
-- the first credited artist, which sorting and album identity rely on.
CREATE TABLE track_artists (
  track_id  INTEGER NOT NULL REFERENCES tracks(id) ON DELETE CASCADE,
  artist_id INTEGER NOT NULL REFERENCES artists(id),
  position  INTEGER NOT NULL,
  PRIMARY KEY (track_id, artist_id)
);
CREATE INDEX idx_track_artists_artist ON track_artists(artist_id);

CREATE TABLE album_artists (
  album_id  INTEGER NOT NULL REFERENCES albums(id) ON DELETE CASCADE,
  artist_id INTEGER NOT NULL REFERENCES artists(id),
  position  INTEGER NOT NULL,
  PRIMARY KEY (album_id, artist_id)
);
CREATE INDEX idx_album_artists_artist ON album_artists(artist_id);

-- Until the next local sync credits every artist, each row keeps its one artist.
INSERT INTO track_artists (track_id, artist_id, position)
SELECT id, artist_id, 0 FROM tracks WHERE artist_id IS NOT NULL;
INSERT INTO album_artists (album_id, artist_id, position)
SELECT id, artist_id, 0 FROM albums;

-- Apple's ID of this one artist, taken from a song's list of credited artists.
-- apple_music_id is the first artist of a whole credit, shared by "9Lana" and
-- "9Lana & AKUGETSU"; it is no longer used to tell artists apart.
ALTER TABLE artists ADD COLUMN apple_artist_id TEXT;
CREATE UNIQUE INDEX idx_artists_apple_artist ON artists(apple_artist_id) WHERE apple_artist_id IS NOT NULL;

-- Other spellings of the same artist ("Riria." for "りりあ。", Apple's "aMEI"
-- for "張惠妹") as a JSON array, so search finds the page by any of them.
ALTER TABLE artists ADD COLUMN aliases TEXT;
