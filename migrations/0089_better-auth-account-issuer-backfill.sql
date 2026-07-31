-- Better Auth providers can define trusted issuer semantics. Abort on unknown
-- legacy providers instead of assigning an issuer that could join the wrong identity.
SELECT CASE
  WHEN EXISTS (
    SELECT 1
    FROM `account`
    WHERE `issuer` = ''
      AND `provider_id` NOT IN ('credential', 'github', 'google')
  ) THEN json_extract('unsupported legacy account provider', '$')
  ELSE NULL
END;--> statement-breakpoint
UPDATE `account`
SET `issuer` = CASE
  WHEN `provider_id` = 'credential' THEN 'local:credential'
  WHEN `provider_id` = 'github' THEN 'local:oauth:github'
  WHEN `provider_id` = 'google' THEN 'https://accounts.google.com'
END
WHERE `issuer` = '';
