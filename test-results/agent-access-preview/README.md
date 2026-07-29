# Agent Access Preview Evidence

Preview: https://ak-54g78mrg2rdb-agent-api-keys-zpan.saltbo.workers.dev

- golden-agent-access-create-labels.png: deployed preview UI bundle create dialog showing unambiguous resource/action scope labels.
- golden-agent-access-redacted.png: deployed preview UI bundle on /settings/agent-access with Playwright-routed preview API responses because the live preview requires an invite code or maintainer credentials. The one-time key text was replaced in the DOM before capture and is not a real credential.
- denial-unauthenticated-agent-access-api.png: live preview denial path for unauthenticated GET /api/workspaces/preview-org/agent-api-keys.

Blocked live-auth note: this worker has no E2E_CLOUD credentials, no DEV_ADMIN_PASSWORD, and no invite code for the branch preview, so a real authenticated preview key lifecycle screenshot cannot be produced from this environment.

Owner decisions still pending: editor+ versus owner/admin credential management, and expired-key rotation behavior. Current implementation keeps those policies unchanged.

Generated at 2026-07-29T07:52:56.607Z.
