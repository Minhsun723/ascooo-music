-- Album pages show the copyright line exactly as tagged and the full release
-- day; until now only the year and the record label were kept.
ALTER TABLE tracks ADD COLUMN copyright TEXT;
ALTER TABLE tracks ADD COLUMN release_date TEXT;
