CREATE TABLE `team_invite_links` (
	`id` text PRIMARY KEY NOT NULL,
	`token` text NOT NULL,
	`organization_id` text NOT NULL,
	`role` text NOT NULL DEFAULT 'member',
	`inviter_id` text NOT NULL,
	`expires_at` integer,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `team_invite_links_token_unique` ON `team_invite_links` (`token`);
