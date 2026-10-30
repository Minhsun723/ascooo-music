-- The motion artwork Apple Music plays at the top of an artist's page: a
-- silent HLS loop that stays on Apple's CDN, and a 16:9 still of it, whose
-- WebP is in R2 like artwork_id. Only some artists have one; the local sync
-- clears both when Apple drops it.
ALTER TABLE artists ADD COLUMN motion_video_url TEXT;
ALTER TABLE artists ADD COLUMN motion_preview_id TEXT;
