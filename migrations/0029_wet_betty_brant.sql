CREATE TABLE `org_quota_entitlements` (
	`id` text PRIMARY KEY NOT NULL,
	`org_id` text NOT NULL,
	`resource_type` text NOT NULL,
	`source` text NOT NULL,
	`source_id` text NOT NULL,
	`bytes` integer NOT NULL,
	`starts_at` integer NOT NULL,
	`expires_at` integer,
	`status` text NOT NULL,
	`metadata` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `org_quota_entitlements_org_resource_idx` ON `org_quota_entitlements` (`org_id`,`resource_type`,`status`);--> statement-breakpoint
CREATE UNIQUE INDEX `org_quota_entitlements_source_resource_uniq` ON `org_quota_entitlements` (`source`,`source_id`,`resource_type`);