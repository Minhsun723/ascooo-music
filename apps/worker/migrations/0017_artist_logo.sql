-- The logo Apple Music shows on an artist's page (their name in their own
-- lettering, on a transparent background). Like artwork_id it names a WebP in
-- R2. Only some artists have one; the local sync clears it when Apple drops it.
ALTER TABLE artists ADD COLUMN logo_artwork_id TEXT;
