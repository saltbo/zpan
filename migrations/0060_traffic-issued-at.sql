ALTER TABLE `cloud_traffic_reports` ADD `issued_at` integer;--> statement-breakpoint
CREATE INDEX `cloud_traffic_reports_issued_idx` ON `cloud_traffic_reports` (`issued_at`);