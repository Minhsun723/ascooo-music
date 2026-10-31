-- The square cut of an artist's motion artwork, which Apple's iPhone app plays
-- in place of the 16:9 one, for the artist page on phones. Like
-- motion_video_url and motion_preview_id: the HLS loop stays on Apple's CDN,
-- its still is a WebP in R2, and the local sync clears both when Apple drops it.
ALTER TABLE artists ADD COLUMN motion_square_video_url TEXT;
ALTER TABLE artists ADD COLUMN motion_square_preview_id TEXT;
