-- Keep the record label/publisher embedded in each audio file so album pages
-- can show it without guessing from the artist or folder structure.
ALTER TABLE tracks ADD COLUMN record_label TEXT;

-- Keep the existing library available after migration. The next regular sync
-- marks older rows for one metadata refresh, then records the new version.
ALTER TABLE tracks ADD COLUMN metadata_version INTEGER NOT NULL DEFAULT 0;
