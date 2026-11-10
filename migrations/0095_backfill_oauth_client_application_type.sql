-- better-auth 1.7.0-rc.3 reads OAuth client kind from application_type (web | native)
-- instead of the legacy type column. Carry existing registrations over so native
-- clients keep their loopback redirect rules; user-agent-based clients are web clients.
UPDATE `oauthClient`
SET `application_type` = CASE `type` WHEN 'native' THEN 'native' ELSE 'web' END
WHERE `application_type` IS NULL AND `type` IS NOT NULL;
