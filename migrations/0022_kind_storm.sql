ALTER TABLE `org_quotas` ADD `traffic_quota` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `org_quotas` ADD `traffic_used` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `org_quotas` ADD `traffic_period` text DEFAULT '1970-01' NOT NULL;--> statement-breakpoint
INSERT INTO `org_quotas` (`id`, `org_id`, `quota`, `used`, `traffic_quota`, `traffic_used`, `traffic_period`)
SELECT 'quota_' || `organization`.`id`, `organization`.`id`, 0, 0, 0, 0, strftime('%Y-%m', 'now')
FROM `organization`
LEFT JOIN `org_quotas` ON `org_quotas`.`org_id` = `organization`.`id`
WHERE `org_quotas`.`org_id` IS NULL;
