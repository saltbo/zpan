CREATE TABLE IF NOT EXISTS `cloud_store_settings` (
  `id` text PRIMARY KEY NOT NULL,
  `enabled` integer DEFAULT false NOT NULL,
  `created_at` integer NOT NULL,
  `updated_at` integer NOT NULL
);
--> statement-breakpoint
INSERT OR IGNORE INTO `system_options` (`key`, `value`, `public`)
SELECT
  'cloud_store_enabled',
  CASE WHEN `enabled` = 1 THEN 'true' ELSE 'false' END,
  0
FROM `cloud_store_settings`
WHERE `id` = 'default';
--> statement-breakpoint
INSERT OR IGNORE INTO `system_options` (`key`, `value`, `public`)
SELECT
  'cloud_store_created_at',
  strftime('%Y-%m-%dT%H:%M:%fZ', `created_at` / 1000.0, 'unixepoch'),
  0
FROM `cloud_store_settings`
WHERE `id` = 'default';
--> statement-breakpoint
INSERT OR IGNORE INTO `system_options` (`key`, `value`, `public`)
SELECT
  'cloud_store_updated_at',
  strftime('%Y-%m-%dT%H:%M:%fZ', `updated_at` / 1000.0, 'unixepoch'),
  0
FROM `cloud_store_settings`
WHERE `id` = 'default';
--> statement-breakpoint
DROP TABLE `cloud_store_settings`;
