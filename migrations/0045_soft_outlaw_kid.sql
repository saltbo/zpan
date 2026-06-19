PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_object_upload_sessions` (
	`id` text PRIMARY KEY NOT NULL,
	`org_id` text NOT NULL,
	`object_id` text NOT NULL,
	`storage_id` text NOT NULL,
	`storage_key` text NOT NULL,
	`upload_id` text,
	`part_size` integer NOT NULL,
	`status` text NOT NULL,
	`created_by` text NOT NULL,
	`expires_at` integer NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
INSERT INTO `__new_object_upload_sessions`("id", "org_id", "object_id", "storage_id", "storage_key", "upload_id", "part_size", "status", "created_by", "expires_at", "created_at", "updated_at") SELECT "id", "org_id", "object_id", "storage_id", "storage_key", "upload_id", "part_size", "status", "created_by", "expires_at", "created_at", "updated_at" FROM `object_upload_sessions`;--> statement-breakpoint
DROP TABLE `object_upload_sessions`;--> statement-breakpoint
ALTER TABLE `__new_object_upload_sessions` RENAME TO `object_upload_sessions`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE INDEX `object_upload_sessions_object_idx` ON `object_upload_sessions` (`org_id`,`object_id`);--> statement-breakpoint
CREATE INDEX `object_upload_sessions_expires_idx` ON `object_upload_sessions` (`expires_at`);