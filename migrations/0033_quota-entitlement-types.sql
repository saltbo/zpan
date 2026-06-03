ALTER TABLE `org_quota_entitlements` ADD `entitlement_type` text DEFAULT 'grant' NOT NULL;--> statement-breakpoint
UPDATE `org_quota_entitlements`
SET `entitlement_type` = 'plan'
WHERE `source_id` LIKE 'stripe_subscription:%'
  AND `status` = 'active'
  AND NOT EXISTS (
    SELECT 1
    FROM `org_quota_entitlements` AS newer_plan
    WHERE newer_plan.`org_id` = `org_quota_entitlements`.`org_id`
      AND newer_plan.`resource_type` = `org_quota_entitlements`.`resource_type`
      AND newer_plan.`status` = 'active'
      AND newer_plan.`source_id` LIKE 'stripe_subscription:%'
      AND (
        newer_plan.`bytes` > `org_quota_entitlements`.`bytes`
        OR (
          newer_plan.`bytes` = `org_quota_entitlements`.`bytes`
          AND newer_plan.`starts_at` > `org_quota_entitlements`.`starts_at`
        )
      )
  );--> statement-breakpoint
UPDATE `org_quota_entitlements`
SET `entitlement_type` = 'grant'
WHERE `entitlement_type` != 'plan';--> statement-breakpoint
INSERT INTO `org_quota_entitlements` (
  `id`,
  `org_id`,
  `resource_type`,
  `entitlement_type`,
  `source`,
  `source_id`,
  `bytes`,
  `starts_at`,
  `expires_at`,
  `status`,
  `metadata`,
  `created_at`,
  `updated_at`
)
SELECT
  'free-plan-storage-' || `org_quotas`.`org_id`,
  `org_quotas`.`org_id`,
  'storage',
  'plan',
  'free_plan',
  'free_plan:' || `org_quotas`.`org_id`,
  `org_quotas`.`quota`,
  CAST(unixepoch('subsecond') * 1000 AS integer),
  NULL,
  'active',
  json_object('packageName', 'Free', 'packageId', NULL, 'source', 'free_plan', 'migratedFrom', 'org_quotas.quota'),
  CAST(unixepoch('subsecond') * 1000 AS integer),
  CAST(unixepoch('subsecond') * 1000 AS integer)
FROM `org_quotas`
WHERE NOT EXISTS (
  SELECT 1
  FROM `org_quota_entitlements`
  WHERE `org_quota_entitlements`.`org_id` = `org_quotas`.`org_id`
    AND `org_quota_entitlements`.`resource_type` = 'storage'
    AND `org_quota_entitlements`.`entitlement_type` = 'plan'
    AND `org_quota_entitlements`.`status` = 'active'
);--> statement-breakpoint
INSERT INTO `org_quota_entitlements` (
  `id`,
  `org_id`,
  `resource_type`,
  `entitlement_type`,
  `source`,
  `source_id`,
  `bytes`,
  `starts_at`,
  `expires_at`,
  `status`,
  `metadata`,
  `created_at`,
  `updated_at`
)
SELECT
  'free-plan-traffic-' || `org_quotas`.`org_id`,
  `org_quotas`.`org_id`,
  'traffic',
  'plan',
  'free_plan',
  'free_plan:' || `org_quotas`.`org_id`,
  `org_quotas`.`traffic_quota`,
  CAST(unixepoch('subsecond') * 1000 AS integer),
  NULL,
  'active',
  json_object('packageName', 'Free', 'packageId', NULL, 'source', 'free_plan', 'migratedFrom', 'org_quotas.traffic_quota'),
  CAST(unixepoch('subsecond') * 1000 AS integer),
  CAST(unixepoch('subsecond') * 1000 AS integer)
FROM `org_quotas`
WHERE NOT EXISTS (
  SELECT 1
  FROM `org_quota_entitlements`
  WHERE `org_quota_entitlements`.`org_id` = `org_quotas`.`org_id`
    AND `org_quota_entitlements`.`resource_type` = 'traffic'
    AND `org_quota_entitlements`.`entitlement_type` = 'plan'
    AND `org_quota_entitlements`.`status` = 'active'
);--> statement-breakpoint
CREATE INDEX `org_quota_entitlements_org_type_idx` ON `org_quota_entitlements` (`org_id`,`resource_type`,`entitlement_type`,`status`);--> statement-breakpoint
CREATE UNIQUE INDEX `org_quota_entitlements_active_plan_uniq` ON `org_quota_entitlements` (`org_id`,`resource_type`,`entitlement_type`) WHERE status = 'active' AND entitlement_type = 'plan';
