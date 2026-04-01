-- Admin plugin: add fields to user table
ALTER TABLE `user` ADD `role` text;
--> statement-breakpoint
ALTER TABLE `user` ADD `banned` integer DEFAULT false;
--> statement-breakpoint
ALTER TABLE `user` ADD `ban_reason` text;
--> statement-breakpoint
ALTER TABLE `user` ADD `ban_expires` integer;
--> statement-breakpoint
-- Admin plugin: add impersonation tracking to session
ALTER TABLE `session` ADD `impersonated_by` text;
--> statement-breakpoint
-- Organization plugin: add active org to session
ALTER TABLE `session` ADD `active_organization_id` text;
--> statement-breakpoint
-- Organization plugin: create organization table
CREATE TABLE `organization` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`slug` text NOT NULL,
	`logo` text,
	`metadata` text,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`updated_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `organization_slug_unique` ON `organization` (`slug`);
--> statement-breakpoint
-- Organization plugin: create member table
CREATE TABLE `member` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`user_id` text NOT NULL,
	`role` text DEFAULT 'member' NOT NULL,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`organization_id`) REFERENCES `organization`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `member_organizationId_idx` ON `member` (`organization_id`);
--> statement-breakpoint
CREATE INDEX `member_userId_idx` ON `member` (`user_id`);
--> statement-breakpoint
-- Organization plugin: create invitation table
CREATE TABLE `invitation` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`email` text NOT NULL,
	`role` text NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`expires_at` integer,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`inviter_id` text NOT NULL,
	FOREIGN KEY (`organization_id`) REFERENCES `organization`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`inviter_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `invitation_organizationId_idx` ON `invitation` (`organization_id`);
--> statement-breakpoint
CREATE INDEX `invitation_email_idx` ON `invitation` (`email`);
--> statement-breakpoint
-- Schema change: rename matters.uid to matters.org_id
ALTER TABLE `matters` RENAME COLUMN `uid` TO `org_id`;
--> statement-breakpoint
-- Schema change: rename storage_quotas to org_quotas with new structure
ALTER TABLE `storage_quotas` RENAME TO `org_quotas`;
--> statement-breakpoint
ALTER TABLE `org_quotas` RENAME COLUMN `uid` TO `org_id`;
--> statement-breakpoint
ALTER TABLE `org_quotas` DROP COLUMN `storage_id`;
