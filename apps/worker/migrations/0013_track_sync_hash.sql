-- Hash of the payload the local sync last imported for each track. The local
-- sync compares it before uploading, so unchanged tracks cost no D1 writes.
ALTER TABLE tracks ADD COLUMN sync_hash TEXT;
