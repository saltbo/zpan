CREATE TABLE `oauthJwtRevocation` (
	`id` text PRIMARY KEY NOT NULL,
	`client_id` text NOT NULL,
	`expires_at` integer NOT NULL,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL
);
--> statement-breakpoint
CREATE INDEX `oauthJwtRevocation_expires_at_idx` ON `oauthJwtRevocation` (`expires_at`);