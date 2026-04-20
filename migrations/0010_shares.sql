CREATE TABLE `shares` (
	`id` text PRIMARY KEY NOT NULL,
	`token` text NOT NULL,
	`kind` text NOT NULL,
	`matter_id` text NOT NULL,
	`org_id` text NOT NULL,
	`creator_id` text NOT NULL,
	`password_hash` text,
	`expires_at` integer,
	`download_limit` integer,
	`views` integer DEFAULT 0 NOT NULL,
	`downloads` integer DEFAULT 0 NOT NULL,
	`status` text DEFAULT 'active' NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `shares_token_unique` ON `shares` (`token`);
--> statement-breakpoint
CREATE INDEX `shares_creator_status_created_idx` ON `shares` (`creator_id`,`status`,`created_at`);
--> statement-breakpoint
CREATE TABLE `share_recipients` (
	`id` text PRIMARY KEY NOT NULL,
	`share_id` text NOT NULL,
	`recipient_user_id` text,
	`recipient_email` text,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `share_recipients_share_id_idx` ON `share_recipients` (`share_id`);
--> statement-breakpoint
CREATE INDEX `share_recipients_user_id_idx` ON `share_recipients` (`recipient_user_id`);
