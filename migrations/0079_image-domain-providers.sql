ALTER TABLE `image_hosting_configs` RENAME COLUMN "cf_hostname_id" TO "provider_hostname_id";--> statement-breakpoint
ALTER TABLE `image_hosting_configs` ADD `domain_provider` text;--> statement-breakpoint
ALTER TABLE `image_hosting_configs` ADD `domain_status` text;--> statement-breakpoint
ALTER TABLE `image_hosting_configs` ADD `domain_error` text;--> statement-breakpoint
ALTER TABLE `image_hosting_configs` ADD `verification_token` text;--> statement-breakpoint
ALTER TABLE `image_hosting_configs` ADD `domain_last_checked_at` integer;