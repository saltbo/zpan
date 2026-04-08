-- Add capacity and used columns for bucket pool support
ALTER TABLE `storages` ADD `capacity` integer NOT NULL DEFAULT 0;
--> statement-breakpoint
ALTER TABLE `storages` ADD `used` integer NOT NULL DEFAULT 0;
--> statement-breakpoint
-- Convert status from integer to text values
UPDATE `storages` SET `status` = CASE WHEN `status` = 1 THEN 'active' ELSE 'disabled' END;
--> statement-breakpoint
-- Drop uid column (storages are global, not per-user)
ALTER TABLE `storages` DROP COLUMN `uid`;
