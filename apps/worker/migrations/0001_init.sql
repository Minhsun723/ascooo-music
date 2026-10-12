-- Ascooo Music — initial schema

CREATE TABLE users (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  username      TEXT NOT NULL UNIQUE COLLATE NOCASE,
  password_hash TEXT NOT NULL,
  role          TEXT NOT NULL DEFAULT 'user', -- 'admin' | 'user'
  created_at    INTEGER NOT NULL
);

CREATE TABLE artists (
  id   INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL UNIQUE COLLATE NOCASE
);

CREATE TABLE albums (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  title      TEXT NOT NULL COLLATE NOCASE,
  artist_id  INTEGER NOT NULL REFERENCES artists(id),
  year       INTEGER,
  artwork_id TEXT,
  created_at INTEGER NOT NULL,
  UNIQUE (title, artist_id)
);

-- Album covers extracted from embedded tags, de-duplicated by SHA-1.
CREATE TABLE artworks (
  id   TEXT PRIMARY KEY,
  mime TEXT NOT NULL,
  data BLOB NOT NULL
);

CREATE TABLE tracks (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  path        TEXT NOT NULL UNIQUE,        -- full WebDAV path on PikPak
  lrc_path    TEXT,                        -- sidecar .lrc next to the audio file
  cover_path  TEXT,                        -- cover.jpg / folder.jpg in the same folder
  size        INTEGER NOT NULL DEFAULT 0,
  etag        TEXT,
  mtime       INTEGER,
  scan_id     TEXT,                        -- last scan that saw this file

  status      TEXT NOT NULL DEFAULT 'pending', -- 'pending' | 'ready' | 'error'
  error       TEXT,

  title       TEXT NOT NULL,
  artist      TEXT,
  artist_id   INTEGER REFERENCES artists(id),
  album_id    INTEGER REFERENCES albums(id),
  track_no    INTEGER,
  disc_no     INTEGER,
  year        INTEGER,
  genre       TEXT,
  duration    REAL,
  codec       TEXT,                        -- 'mp3' | 'aac' | 'alac' | 'flac' ...
  bitrate     INTEGER,                     -- kbps
  sample_rate INTEGER,
  bit_depth   INTEGER,
  channels    INTEGER,
  artwork_id  TEXT,
  has_lyrics  INTEGER NOT NULL DEFAULT 0,

  added_at    INTEGER NOT NULL,
  updated_at  INTEGER NOT NULL
);

CREATE INDEX idx_tracks_status   ON tracks(status);
CREATE INDEX idx_tracks_album    ON tracks(album_id, disc_no, track_no);
CREATE INDEX idx_tracks_artist   ON tracks(artist_id);
CREATE INDEX idx_tracks_added    ON tracks(added_at DESC);
CREATE INDEX idx_tracks_title    ON tracks(title COLLATE NOCASE);

CREATE TABLE lyrics (
  track_id INTEGER PRIMARY KEY REFERENCES tracks(id) ON DELETE CASCADE,
  content  TEXT NOT NULL,
  synced   INTEGER NOT NULL DEFAULT 0,     -- 1 when content is timestamped LRC
  source   TEXT NOT NULL                   -- 'embedded' | 'lrc'
);

CREATE TABLE favorites (
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  track_id   INTEGER NOT NULL REFERENCES tracks(id) ON DELETE CASCADE,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (user_id, track_id)
);

CREATE TABLE playlists (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name        TEXT NOT NULL,
  description TEXT,
  created_at  INTEGER NOT NULL,
  updated_at  INTEGER NOT NULL
);

CREATE TABLE playlist_tracks (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  playlist_id INTEGER NOT NULL REFERENCES playlists(id) ON DELETE CASCADE,
  track_id    INTEGER NOT NULL REFERENCES tracks(id) ON DELETE CASCADE,
  position    REAL NOT NULL,
  added_at    INTEGER NOT NULL
);

CREATE INDEX idx_playlist_tracks ON playlist_tracks(playlist_id, position);

CREATE TABLE play_history (
  id        INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id   INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  track_id  INTEGER NOT NULL REFERENCES tracks(id) ON DELETE CASCADE,
  played_at INTEGER NOT NULL
);

CREATE INDEX idx_history_user ON play_history(user_id, played_at DESC);
