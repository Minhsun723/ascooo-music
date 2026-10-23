-- Sessions carry the version they were issued with and are re-checked against
-- it hourly. Bumping it (on password change) signs out the user's other devices.
ALTER TABLE users ADD COLUMN session_version INTEGER NOT NULL DEFAULT 0;
