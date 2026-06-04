CREATE INDEX `download_tasks_org_category_idx` ON `download_tasks` (`org_id`,`category`);--> statement-breakpoint
CREATE INDEX `download_tasks_org_tags_idx` ON `download_tasks` (`org_id`,`tags`);