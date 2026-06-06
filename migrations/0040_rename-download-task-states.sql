-- Custom SQL migration file, put your code below! --
UPDATE `download_tasks` SET `status` = 'downloading' WHERE `status` = 'running';--> statement-breakpoint
UPDATE `download_tasks` SET `status` = 'suspended' WHERE `status` = 'billing_paused';
