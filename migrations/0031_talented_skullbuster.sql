CREATE TABLE `background_jobs` (
	`id` text PRIMARY KEY NOT NULL,
	`org_id` text NOT NULL,
	`user_id` text NOT NULL,
	`type` text NOT NULL,
	`status` text NOT NULL,
	`target_folder` text,
	`target_path` text,
	`metadata` text,
	`input_bytes` integer DEFAULT 0 NOT NULL,
	`output_bytes` integer DEFAULT 0 NOT NULL,
	`processed_bytes` integer DEFAULT 0 NOT NULL,
	`file_count` integer DEFAULT 0 NOT NULL,
	`current_filename` text,
	`error_message` text,
	`result_metadata` text,
	`retryable` integer DEFAULT false NOT NULL,
	`cancelable` integer DEFAULT true NOT NULL,
	`retried_from_job_id` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`started_at` integer,
	`finished_at` integer
);
--> statement-breakpoint
CREATE INDEX `background_jobs_org_created_idx` ON `background_jobs` (`org_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `background_jobs_org_status_idx` ON `background_jobs` (`org_id`,`status`);--> statement-breakpoint
CREATE INDEX `background_jobs_org_type_idx` ON `background_jobs` (`org_id`,`type`);