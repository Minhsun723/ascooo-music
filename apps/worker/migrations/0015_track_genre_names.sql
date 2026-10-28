-- Tags name one genre in several languages ("J-Pop" / "日本流行樂"). The local
-- sync now stores Apple Music's genre in Traditional Chinese and English;
-- `genre` keeps the tag as read and is only shown when neither is known.
ALTER TABLE tracks ADD COLUMN genre_zh TEXT;
ALTER TABLE tracks ADD COLUMN genre_en TEXT;
