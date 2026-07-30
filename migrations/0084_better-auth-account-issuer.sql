ALTER TABLE `account` ADD `issuer` text DEFAULT '' NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX `account_issuer_providerAccountId_unique` ON `account` (`issuer`,`account_id`);