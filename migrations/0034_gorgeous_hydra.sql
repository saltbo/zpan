ALTER TABLE `cloud_traffic_reports` ADD `storage_id` text;--> statement-breakpoint
ALTER TABLE `cloud_traffic_reports` ADD `unit_bytes` integer;--> statement-breakpoint
ALTER TABLE `cloud_traffic_reports` ADD `credits_per_unit` integer;--> statement-breakpoint
ALTER TABLE `storages` ADD `egress_credit_billing_enabled` integer DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `storages` ADD `egress_credit_unit_bytes` integer DEFAULT 104857600 NOT NULL;--> statement-breakpoint
ALTER TABLE `storages` ADD `egress_credit_per_unit` integer DEFAULT 1 NOT NULL;