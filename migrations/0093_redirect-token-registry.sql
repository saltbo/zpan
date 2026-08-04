CREATE TABLE `redirect_token_registry` (
	`token` text PRIMARY KEY NOT NULL,
	`kind` text NOT NULL,
	`resource_id` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `redirect_token_registry_resource_id_unique` ON `redirect_token_registry` (`resource_id`);