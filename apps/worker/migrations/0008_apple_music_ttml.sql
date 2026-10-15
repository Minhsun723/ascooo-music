-- Apple Music enrichment remains optional and preserves the original embedded
-- metadata. Only display overrides and stable catalog identifiers live in D1;
-- artist image bytes stay in R2 and the original TTML stays in PikPak.
ALTER TABLE tracks ADD COLUMN display_title TEXT;
ALTER TABLE tracks ADD COLUMN display_artist TEXT;
ALTER TABLE tracks ADD COLUMN apple_music_id TEXT;
ALTER TABLE tracks ADD COLUMN apple_isrc TEXT;

ALTER TABLE artists ADD COLUMN display_name TEXT;
ALTER TABLE artists ADD COLUMN apple_music_id TEXT;
ALTER TABLE artists ADD COLUMN artwork_id TEXT;

ALTER TABLE lyrics ADD COLUMN format TEXT NOT NULL DEFAULT 'plain';
UPDATE lyrics
SET format = CASE
  WHEN source = 'lrc' OR synced = 1 THEN 'lrc'
  ELSE 'plain'
END;
