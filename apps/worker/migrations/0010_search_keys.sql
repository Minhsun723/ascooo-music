-- Normalized search text (NFKC, lower case, katakana, no spaces/punctuation),
-- computed by the Worker on every write. SQLite cannot normalize Unicode, so
-- existing rows are filled by scripts/backfill-search-keys.mts. No index:
-- substring LIKE '%…%' scans the table either way.
ALTER TABLE tracks ADD COLUMN search_key TEXT;
ALTER TABLE albums ADD COLUMN search_key TEXT;
ALTER TABLE artists ADD COLUMN search_key TEXT;
