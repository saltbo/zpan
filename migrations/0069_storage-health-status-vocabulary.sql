PRAGMA defer_foreign_keys=ON;--> statement-breakpoint
CREATE TABLE `__new_storages` (
	`id` text PRIMARY KEY NOT NULL,
	`provider` text DEFAULT '' NOT NULL,
	`bucket` text NOT NULL,
	`endpoint` text NOT NULL,
	`region` text DEFAULT 'auto' NOT NULL,
	`access_key` text NOT NULL,
	`secret_key` text NOT NULL,
	`file_path` text DEFAULT '' NOT NULL,
	`custom_host` text DEFAULT '',
	`capacity` integer DEFAULT 0 NOT NULL,
	`egress_credit_billing_enabled` integer DEFAULT false NOT NULL,
	`egress_credit_unit_bytes` integer DEFAULT 104857600 NOT NULL,
	`egress_credit_per_unit` integer DEFAULT 1 NOT NULL,
	`force_path_style` integer DEFAULT true NOT NULL,
	`used` integer DEFAULT 0 NOT NULL,
	`enabled` integer DEFAULT true NOT NULL,
	`status` text DEFAULT 'unknown' NOT NULL,
	`status_reason` text,
	`status_checked_at` integer,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
INSERT INTO `__new_storages`("id", "provider", "bucket", "endpoint", "region", "access_key", "secret_key", "file_path", "custom_host", "capacity", "egress_credit_billing_enabled", "egress_credit_unit_bytes", "egress_credit_per_unit", "force_path_style", "used", "enabled", "status", "status_reason", "status_checked_at", "created_at", "updated_at") SELECT "id", "provider", "bucket", "endpoint", "region", "access_key", "secret_key", "file_path", "custom_host", "capacity", "egress_credit_billing_enabled", "egress_credit_unit_bytes", "egress_credit_per_unit", "force_path_style", "used", "enabled", "status", "status_reason", "status_checked_at", "created_at", "updated_at" FROM `storages`;--> statement-breakpoint
DROP TABLE `storages`;--> statement-breakpoint
ALTER TABLE `__new_storages` RENAME TO `storages`;--> statement-breakpoint
PRAGMA defer_foreign_keys=OFF;
