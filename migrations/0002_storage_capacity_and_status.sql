-- Add capacity and used fields to storages table
ALTER TABLE `storages` ADD `capacity` integer DEFAULT 0 NOT NULL;
--> statement-breakpoint
ALTER TABLE `storages` ADD `used` integer DEFAULT 0 NOT NULL;
--> statement-breakpoint
-- Change status from integer to text (SQLite doesn't support ALTER COLUMN type,
-- but the column accepts any type, so we update existing values in place)
UPDATE `storages` SET `status` = 'active' WHERE `status` = '1' OR `status` = 1;
--> statement-breakpoint
UPDATE `storages` SET `status` = 'disabled' WHERE `status` = '0' OR `status` = 0;
