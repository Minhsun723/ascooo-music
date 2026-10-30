-- Apple Music's 4:1 header image for an artist (bannerUber), shown behind the
-- artist page's hero when there is no motion artwork. Like artwork_id it names
-- a WebP in R2; the local sync clears it when Apple drops it.
ALTER TABLE artists ADD COLUMN banner_artwork_id TEXT;
