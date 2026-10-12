-- Re-run metadata extraction so existing tracks benefit from the expanded MP4
-- artwork paths and folder-cover matching introduced with cover signatures.
UPDATE tracks SET status = 'pending';
