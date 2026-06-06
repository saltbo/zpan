ALTER TABLE `download_tasks` RENAME COLUMN "name" TO "display_name";--> statement-breakpoint
ALTER TABLE `download_tasks` RENAME COLUMN "authorized_bytes" TO "billing_authorized_bytes";--> statement-breakpoint
ALTER TABLE `download_tasks` RENAME COLUMN "billed_bytes" TO "billing_charged_bytes";--> statement-breakpoint
ALTER TABLE `download_tasks` RENAME COLUMN "billed_credits" TO "billing_charged_credits";--> statement-breakpoint
ALTER TABLE `download_tasks` RENAME COLUMN "detail" TO "runtime";--> statement-breakpoint
ALTER TABLE `download_tasks` ADD `error_code` text;--> statement-breakpoint
UPDATE `download_tasks`
SET `runtime` = json_object(
  'engine', json_extract(CASE WHEN `runtime` IS NOT NULL AND json_valid(`runtime`) THEN `runtime` ELSE '{}' END, '$.engine'),
  'state', json_extract(CASE WHEN `runtime` IS NOT NULL AND json_valid(`runtime`) THEN `runtime` ELSE '{}' END, '$.engineState'),
  'phase', json_extract(CASE WHEN `runtime` IS NOT NULL AND json_valid(`runtime`) THEN `runtime` ELSE '{}' END, '$.phase'),
  'message', json_extract(CASE WHEN `runtime` IS NOT NULL AND json_valid(`runtime`) THEN `runtime` ELSE '{}' END, '$.message'),
  'etaSeconds', json_extract(CASE WHEN `runtime` IS NOT NULL AND json_valid(`runtime`) THEN `runtime` ELSE '{}' END, '$.etaSeconds'),
  'connections', json_extract(CASE WHEN `runtime` IS NOT NULL AND json_valid(`runtime`) THEN `runtime` ELSE '{}' END, '$.connections'),
  'progress', json_object(
    'download', json_object(
      'bytes', coalesce(`downloaded_bytes`, 0),
      'totalBytes', `total_bytes`,
      'bytesPerSecond', coalesce(`download_bps`, 0)
    ),
    'upload', json_object(
      'bytes', coalesce(`uploaded_bytes`, 0),
      'totalBytes', `total_bytes`,
      'bytesPerSecond', coalesce(`upload_bps`, 0)
    )
  ),
  'torrent', json_object(
    'infoHash', json_extract(CASE WHEN `runtime` IS NOT NULL AND json_valid(`runtime`) THEN `runtime` ELSE '{}' END, '$.infoHash'),
    'name', json_extract(CASE WHEN `runtime` IS NOT NULL AND json_valid(`runtime`) THEN `runtime` ELSE '{}' END, '$.torrentName'),
    'seeders', json_extract(CASE WHEN `runtime` IS NOT NULL AND json_valid(`runtime`) THEN `runtime` ELSE '{}' END, '$.seeders'),
    'leechers', json_extract(CASE WHEN `runtime` IS NOT NULL AND json_valid(`runtime`) THEN `runtime` ELSE '{}' END, '$.leechers'),
    'peers', json_extract(CASE WHEN `runtime` IS NOT NULL AND json_valid(`runtime`) THEN `runtime` ELSE '{}' END, '$.peers')
  ),
  'seeding', json_object(
    'uploadedBytes', json_extract(CASE WHEN `runtime` IS NOT NULL AND json_valid(`runtime`) THEN `runtime` ELSE '{}' END, '$.peerUploadedBytes'),
    'uploadBytesPerSecond', json_extract(CASE WHEN `runtime` IS NOT NULL AND json_valid(`runtime`) THEN `runtime` ELSE '{}' END, '$.peerUploadBps')
  ),
  'trackers', json_extract(CASE WHEN `runtime` IS NOT NULL AND json_valid(`runtime`) THEN `runtime` ELSE '{}' END, '$.trackers'),
  'peers', json_extract(CASE WHEN `runtime` IS NOT NULL AND json_valid(`runtime`) THEN `runtime` ELSE '{}' END, '$.peerSamples'),
  'files', json_extract(CASE WHEN `runtime` IS NOT NULL AND json_valid(`runtime`) THEN `runtime` ELSE '{}' END, '$.files')
);--> statement-breakpoint
UPDATE `download_tasks` SET `runtime` = json_remove(`runtime`, '$.engine') WHERE json_type(`runtime`, '$.engine') = 'null';--> statement-breakpoint
UPDATE `download_tasks` SET `runtime` = json_remove(`runtime`, '$.state') WHERE json_type(`runtime`, '$.state') = 'null';--> statement-breakpoint
UPDATE `download_tasks` SET `runtime` = json_remove(`runtime`, '$.phase') WHERE json_type(`runtime`, '$.phase') = 'null';--> statement-breakpoint
UPDATE `download_tasks` SET `runtime` = json_remove(`runtime`, '$.message') WHERE json_type(`runtime`, '$.message') = 'null';--> statement-breakpoint
UPDATE `download_tasks` SET `runtime` = json_remove(`runtime`, '$.updatedAt') WHERE json_type(`runtime`, '$.updatedAt') = 'null';--> statement-breakpoint
UPDATE `download_tasks` SET `runtime` = json_remove(`runtime`, '$.connections') WHERE json_type(`runtime`, '$.connections') = 'null';--> statement-breakpoint
UPDATE `download_tasks` SET `runtime` = json_remove(`runtime`, '$.trackers') WHERE json_type(`runtime`, '$.trackers') = 'null';--> statement-breakpoint
UPDATE `download_tasks` SET `runtime` = json_remove(`runtime`, '$.peers') WHERE json_type(`runtime`, '$.peers') = 'null';--> statement-breakpoint
UPDATE `download_tasks` SET `runtime` = json_remove(`runtime`, '$.files') WHERE json_type(`runtime`, '$.files') = 'null';--> statement-breakpoint
UPDATE `download_tasks` SET `runtime` = json_remove(`runtime`, '$.torrent.infoHash') WHERE json_type(`runtime`, '$.torrent.infoHash') = 'null';--> statement-breakpoint
UPDATE `download_tasks` SET `runtime` = json_remove(`runtime`, '$.torrent.name') WHERE json_type(`runtime`, '$.torrent.name') = 'null';--> statement-breakpoint
UPDATE `download_tasks` SET `runtime` = json_remove(`runtime`, '$.torrent.seeders') WHERE json_type(`runtime`, '$.torrent.seeders') = 'null';--> statement-breakpoint
UPDATE `download_tasks` SET `runtime` = json_remove(`runtime`, '$.torrent.leechers') WHERE json_type(`runtime`, '$.torrent.leechers') = 'null';--> statement-breakpoint
UPDATE `download_tasks` SET `runtime` = json_remove(`runtime`, '$.torrent.peers') WHERE json_type(`runtime`, '$.torrent.peers') = 'null';--> statement-breakpoint
UPDATE `download_tasks` SET `runtime` = json_remove(`runtime`, '$.seeding.enabled') WHERE json_type(`runtime`, '$.seeding.enabled') = 'null';--> statement-breakpoint
UPDATE `download_tasks` SET `runtime` = json_remove(`runtime`, '$.seeding.active') WHERE json_type(`runtime`, '$.seeding.active') = 'null';--> statement-breakpoint
UPDATE `download_tasks` SET `runtime` = json_remove(`runtime`, '$.seeding.uploadedBytes') WHERE json_type(`runtime`, '$.seeding.uploadedBytes') = 'null';--> statement-breakpoint
UPDATE `download_tasks` SET `runtime` = json_remove(`runtime`, '$.seeding.uploadBytesPerSecond') WHERE json_type(`runtime`, '$.seeding.uploadBytesPerSecond') = 'null';--> statement-breakpoint
UPDATE `download_tasks` SET `runtime` = json_remove(`runtime`, '$.seeding.ratio') WHERE json_type(`runtime`, '$.seeding.ratio') = 'null';--> statement-breakpoint
ALTER TABLE `download_tasks` DROP COLUMN `downloaded_bytes`;--> statement-breakpoint
ALTER TABLE `download_tasks` DROP COLUMN `uploaded_bytes`;--> statement-breakpoint
ALTER TABLE `download_tasks` DROP COLUMN `total_bytes`;--> statement-breakpoint
ALTER TABLE `download_tasks` DROP COLUMN `download_bps`;--> statement-breakpoint
ALTER TABLE `download_tasks` DROP COLUMN `upload_bps`;--> statement-breakpoint
ALTER TABLE `download_tasks` DROP COLUMN `upload_token_hash`;--> statement-breakpoint
ALTER TABLE `download_tasks` DROP COLUMN `upload_token_jti`;--> statement-breakpoint
ALTER TABLE `download_tasks` DROP COLUMN `upload_token_issued_at`;--> statement-breakpoint
ALTER TABLE `download_tasks` DROP COLUMN `upload_token_expires_at`;
