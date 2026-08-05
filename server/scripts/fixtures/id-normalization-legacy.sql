INSERT INTO user (id, name, email, email_verified, created_at, updated_at)
VALUES ('_legacyUser', 'Legacy User', 'legacy-id-rehearsal@example.invalid', 1, 1700000000000, 1700000000000);

INSERT INTO organization (id, name, slug, created_at, updated_at)
VALUES ('legacyOrg-', 'Legacy Organization', 'legacy-id-rehearsal', 1700000000000, 1700000000000);

INSERT INTO member (id, organization_id, user_id, role, created_at)
VALUES ('legacyMember_', 'legacyOrg-', '_legacyUser', 'owner', 1700000000000);

INSERT INTO session (id, expires_at, token, created_at, updated_at, user_id, active_organization_id)
VALUES (
  'legacySession-', 4700000000000, 'legacy_session_token', 1700000000000, 1700000000000,
  '_legacyUser', 'legacyOrg-'
);

INSERT INTO storages (
  id, provider, bucket, endpoint, region, access_key, secret_key, file_path, capacity,
  force_path_style, used, enabled, status, created_at, updated_at
) VALUES (
  '_legacyUser', 's3', 'rehearsal', 'https://storage.example.invalid', 'auto',
  'not-a-real-key', 'not-a-real-secret', '', 1000000, 1, 7, 1, 'healthy', 1700000000, 1700000000
);

INSERT INTO matters (
  id, org_id, alias, name, type, size, dirtype, parent, object, storage_id, status, created_at, updated_at
) VALUES (
  'legacyMatter-', 'legacyOrg-', '_legacyAlias_', 'legacy.txt', 'text/plain', 7, 0, '',
  'objects/legacyOrg-/legacyMatter-', '_legacyUser', 'active', 1700000000, 1700000000
);

INSERT INTO shares (
  id, token, kind, matter_id, org_id, creator_id, views, downloads, status, private, created_at
) VALUES (
  'legacyShare_', 'ds_legacy-token', 'direct', 'legacyMatter-', 'legacyOrg-', '_legacyUser',
  0, 0, 'active', 0, 1700000000
);

INSERT INTO image_hosting_configs (org_id, verification_token, created_at, updated_at)
VALUES ('legacyOrg-', 'verify_token-', 1700000000000, 1700000000000);

INSERT INTO image_hostings (
  id, org_id, token, path, storage_id, storage_key, size, mime, status, access_count, created_at
) VALUES (
  '_legacyImage', 'legacyOrg-', 'ih_legacy-token', 'legacy.png', '_legacyUser',
  'ih/legacyOrg-/_legacyImage.png', 7, 'image/png', 'active', 0, 1700000000000
);

INSERT INTO audit_events (
  id, org_id, user_id, action, target_type, target_id, target_name, metadata, created_at,
  actor_type, actor_ref
) VALUES (
  'event:download_issued:legacyMatter-', 'legacyOrg-', '_legacyUser', 'object_download',
  'matter', 'legacyMatter-', 'legacy.txt',
  '{"matterId":"legacyMatter-","storageId":"_legacyUser","orgId":"legacyOrg-"}',
  1700000000, 'user', '_legacyUser'
);

INSERT INTO resource_changes (
  scope_type, scope_id, resource_type, resource_id, change_type, action, metadata, occurred_at
) VALUES (
  'organization', 'legacyOrg-', 'share', 'legacyShare_', 'upsert', 'share_create',
  '{"userId":"_legacyUser","storageId":"_legacyUser"}', 1700000000000
);

INSERT INTO storage_usage_ledger (
  id, event_key, org_id, storage_id, resource_type, resource_id,
  delta_bytes, reason, occurred_at, created_at
) VALUES (
  'opening:legacyOrg-:_legacyUser', 'opening:legacyOrg-:_legacyUser',
  'legacyOrg-', '_legacyUser', 'storage', '_legacyUser',
  7, 'opening_balance', 1700000000000, 1700000000000
);

INSERT INTO cloud_traffic_reports (
  id, org_id, period, source, source_id, event_id, bytes, storage_id,
  status, attempt_count, created_at, updated_at
) VALUES (
  'trafficReport_', 'legacyOrg-', '2023-11', 'direct_share', 'legacyShare_',
  'traffic_legacyShare_', 7, '_legacyUser', 'reported', 1, 1700000000000, 1700000000000
);

INSERT INTO org_quota_entitlements (
  id, org_id, resource_type, entitlement_type, source, source_id, bytes,
  starts_at, status, metadata, created_at, updated_at
) VALUES (
  'quotaEntitlement_', 'legacyOrg-', 'storage', 'plan', 'free_plan',
  'free_plan:legacyOrg-', 1000000, 1700000000000, 'active',
  '{"targetOrgId":"legacyOrg-"}', 1700000000000, 1700000000000
);

INSERT INTO notifications (
  id, user_id, type, title, body, ref_type, ref_id, metadata, created_at
) VALUES (
  'legacyNotification-', '_legacyUser', 'share_received', 'Legacy share', '', 'share', 'legacyShare_',
  '{"shareId":"legacyShare_","token":"ds_legacy-token"}', 1700000000
);

INSERT INTO apikey (
  id, config_id, name, reference_id, key, created_at, updated_at
) VALUES (
  'legacyApiKey-', 'webdav', 'Legacy API key', '_legacyUser', 'irreversible-key-hash',
  1700000000000, 1700000000000
);

INSERT INTO downloaders (
  id, name, token_hash, token_jti, created_by, created_at, updated_at
) VALUES (
  'legacyDownloader-', 'Legacy downloader', 'irreversible-downloader-hash', 'legacy-downloader-jti',
  '_legacyUser', 1700000000000, 1700000000000
);

INSERT INTO download_tasks (
  id, org_id, created_by_user_id, source_type, source_uri, display_name, target_folder,
  assigned_downloader_id, status, events, created_at, updated_at
) VALUES (
  'legacyTask-', 'legacyOrg-', '_legacyUser', 'http', 'https://example.invalid/file', 'legacy.txt', '',
  'legacyDownloader-', 'completed', '[{"id":"initial:legacyTask-","type":"status_changed"}]',
  1700000000000, 1700000000000
);

INSERT INTO object_upload_sessions (
  id, org_id, object_id, storage_id, storage_key, upload_id, part_size, status, created_by,
  expires_at, created_at, updated_at
) VALUES (
  'legacyUpload-', 'legacyOrg-', 'legacyMatter-', '_legacyUser',
  'objects/legacyOrg-/legacyMatter-', 'provider-multipart-id', 8388608, 'completed',
  'downloader:legacyDownloader-', 4700000000000, 1700000000000, 1700000000000
);

INSERT INTO object_upload_sessions (
  id, org_id, object_id, storage_id, storage_key, upload_id, part_size, status, created_by,
  expires_at, created_at, updated_at
) VALUES (
  'legacyUserUpload-', 'legacyOrg-', 'legacyMatter-', '_legacyUser',
  'objects/legacyOrg-/legacyMatter-user', NULL, 8388608, 'completed',
  '_legacyUser', 4700000000000, 1700000000000, 1700000000000
);

INSERT INTO downloader_bootstrap_credentials (
  id, token_hash, user_id, device_code, client_id, scope, expires_at, created_at
) VALUES (
  'legacyBootstrap-', 'irreversible-bootstrap-hash', '_legacyUser', 'protocol-device-code',
  'zpan-downloader', 'openid', 4700000000000, 1700000000000
);

INSERT INTO oauthClient (
  id, client_id, user_id, name, redirect_uris, created_at, updated_at
) VALUES (
  'legacyDynamicClient-', 'dynamic-client', '_legacyUser', 'Dynamic client',
  '["https://client.example.invalid/callback"]', 1700000000000, 1700000000000
), (
  'legacyStaticClient-', 'static-client', '_legacyUser', 'Static client',
  '["https://static.example.invalid/callback"]', 1700000000000, 1700000000000
);

INSERT INTO oauthClientRegistration (client_id, token_hash, created_at, updated_at)
VALUES ('dynamic-client', 'irreversible-registration-hash', 1700000000000, 1700000000000);

INSERT INTO oauthConsent (
  id, client_id, user_id, authorization_details, scopes, created_at, updated_at
) VALUES (
  'legacyConsent-', 'static-client', '_legacyUser',
  '[{"type":"zpan_workspace","identifier":"legacyOrg-"}]', '["openid"]',
  1700000000000, 1700000000000
);

INSERT INTO jwks (id, public_key, private_key, created_at)
VALUES ('protocol-key-id', 'not-a-real-public-key', 'not-a-real-private-key', 1700000000000);
