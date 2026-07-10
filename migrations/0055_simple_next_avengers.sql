DROP INDEX `image_hostings_org_created_idx`;--> statement-breakpoint
CREATE INDEX `image_hostings_org_status_created_id_idx` ON `image_hostings` (`org_id`,`status`,`created_at`,`id`);