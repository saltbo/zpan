CREATE TABLE `resource_changes` (
	`sequence` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`scope_type` text NOT NULL,
	`scope_id` text NOT NULL,
	`resource_type` text NOT NULL,
	`resource_id` text NOT NULL,
	`change_type` text NOT NULL,
	`action` text,
	`metadata` text,
	`occurred_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `resource_changes_scope_sequence_idx` ON `resource_changes` (`scope_type`,`scope_id`,`sequence`);--> statement-breakpoint
CREATE INDEX `resource_changes_resource_sequence_idx` ON `resource_changes` (`resource_type`,`resource_id`,`sequence`);--> statement-breakpoint
CREATE INDEX `resource_changes_occurred_idx` ON `resource_changes` (`occurred_at`);