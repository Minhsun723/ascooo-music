-- Track changes to a folder cover even when its path stays the same.
ALTER TABLE tracks ADD COLUMN cover_signature TEXT;
