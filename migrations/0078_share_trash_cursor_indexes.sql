DROP INDEX `shares_creator_status_created_idx`;--> statement-breakpoint
CREATE INDEX `shares_creator_status_created_idx` ON `shares` (`creator_id`,`status`,`created_at`,`id`);--> statement-breakpoint
CREATE INDEX `matters_trash_page_idx` ON `matters` (`org_id`,`status`,`purged_at`,`trashed_at`,`created_at`,`id`);--> statement-breakpoint
CREATE INDEX `share_recipients_email_idx` ON `share_recipients` (`recipient_email`);