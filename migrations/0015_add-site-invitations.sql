CREATE TABLE `site_invitations` (
	`id` text PRIMARY KEY NOT NULL,
	`email` text NOT NULL,
	`token` text NOT NULL,
	`invited_by` text NOT NULL,
	`accepted_by` text,
	`accepted_at` integer,
	`revoked_by` text,
	`revoked_at` integer,
	`expires_at` integer NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `site_invitations_token_unique` ON `site_invitations` (`token`);--> statement-breakpoint
CREATE INDEX `site_invitations_email_idx` ON `site_invitations` (`email`);--> statement-breakpoint
CREATE INDEX `site_invitations_created_idx` ON `site_invitations` (`created_at`);--> statement-breakpoint
CREATE INDEX `site_invitations_expires_idx` ON `site_invitations` (`expires_at`);