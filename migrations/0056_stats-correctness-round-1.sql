DROP INDEX `org_quota_entitlements_active_plan_uniq`;--> statement-breakpoint
CREATE UNIQUE INDEX `org_quota_entitlements_active_plan_uniq` ON `org_quota_entitlements` (`org_id`,`resource_type`,`entitlement_type`) WHERE status = 'active' AND entitlement_type = 'plan' AND source <> 'free_plan';--> statement-breakpoint
ALTER TABLE `cloud_traffic_reports` ADD `attempt_count` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `cloud_traffic_reports` ADD `next_retry_at` integer;--> statement-breakpoint
CREATE INDEX `cloud_traffic_reports_retry_idx` ON `cloud_traffic_reports` (`status`,`next_retry_at`,`created_at`);