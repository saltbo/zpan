DROP INDEX `account_issuer_providerAccountId_unique`;--> statement-breakpoint
CREATE UNIQUE INDEX `account_providerId_accountId_unique` ON `account` (`provider_id`,`account_id`);