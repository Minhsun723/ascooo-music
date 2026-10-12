-- Administrators can keep a synced track in the catalogue while hiding it
-- from the listener-facing library.
ALTER TABLE tracks ADD COLUMN visible INTEGER NOT NULL DEFAULT 1;

CREATE INDEX idx_tracks_visible ON tracks(visible, status);
