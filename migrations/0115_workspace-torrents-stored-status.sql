-- A Torrents list entry stores only whether it failed (#771). The status the
-- list shows (resolving, downloading, verifying, paused, ready) is derived from
-- the entry's torrent and tasks, so the stored resolving, downloading and ready
-- become active. Safe to run again: it only touches rows not yet migrated.
UPDATE `workspace_torrents` SET `status` = 'active' WHERE `status` NOT IN ('active', 'failed');
