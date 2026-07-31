CREATE TABLE `x402_capacity_purchase_intents` (
	`id` text PRIMARY KEY NOT NULL,
	`org_id` text NOT NULL,
	`resource_id` text NOT NULL,
	`request_hash` text NOT NULL,
	`idempotency_key` text NOT NULL,
	`cloud_order_id` text,
	`cloud_attempt_id` text,
	`status` text DEFAULT 'created' NOT NULL,
	`expires_at` integer,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `x402_capacity_purchase_intents_org_request_uniq` ON `x402_capacity_purchase_intents` (`org_id`,`resource_id`,`request_hash`);--> statement-breakpoint
CREATE UNIQUE INDEX `x402_capacity_purchase_intents_idempotency_uniq` ON `x402_capacity_purchase_intents` (`idempotency_key`);--> statement-breakpoint
CREATE INDEX `x402_capacity_purchase_intents_attempt_idx` ON `x402_capacity_purchase_intents` (`cloud_attempt_id`);--> statement-breakpoint
DROP INDEX `org_quota_entitlements_active_plan_uniq`;