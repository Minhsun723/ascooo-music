-- Dolby Atmos (EC-3) only plays in some browsers. An AAC 5.1 copy with the
-- same file name may live in AAC51_ROOT; it shares every piece of metadata
-- with the main track and only replaces the audio that is streamed.
ALTER TABLE tracks ADD COLUMN alt_path TEXT;
ALTER TABLE tracks ADD COLUMN alt_size INTEGER;
ALTER TABLE tracks ADD COLUMN alt_etag TEXT;
