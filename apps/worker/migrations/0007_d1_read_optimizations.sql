-- Index the predicates and sort orders used by the listener-facing library.
CREATE INDEX idx_albums_artist ON albums(artist_id);
CREATE INDEX idx_tracks_library_added ON tracks(status, visible, added_at DESC, id DESC);
CREATE INDEX idx_tracks_library_artist ON tracks(artist_id, status, visible);
CREATE INDEX idx_tracks_library_album ON tracks(album_id, status, visible);
CREATE INDEX idx_tracks_errors_updated ON tracks(updated_at DESC) WHERE error IS NOT NULL;
CREATE INDEX idx_tracks_artwork ON tracks(artwork_id) WHERE artwork_id IS NOT NULL;
CREATE INDEX idx_albums_artwork ON albums(artwork_id) WHERE artwork_id IS NOT NULL;

-- Raw play history grows without bound and made artist/home queries repeatedly
-- scan old events. Keep a compact row per user and track for both play counts
-- and recent-play ordering. Existing history is folded in once by the migration.
CREATE TABLE play_stats (
  user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  track_id    INTEGER NOT NULL REFERENCES tracks(id) ON DELETE CASCADE,
  play_count  INTEGER NOT NULL DEFAULT 0,
  last_played INTEGER NOT NULL,
  PRIMARY KEY (user_id, track_id)
);

INSERT INTO play_stats (user_id, track_id, play_count, last_played)
SELECT user_id, track_id, COUNT(*), MAX(played_at)
FROM play_history
GROUP BY user_id, track_id;

CREATE INDEX idx_play_stats_recent ON play_stats(user_id, last_played DESC);
CREATE INDEX idx_play_stats_track ON play_stats(track_id);
