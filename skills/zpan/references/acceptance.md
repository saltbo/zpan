# Acceptance Evidence

For release or preview verification, record the exact origin, Restish version,
plugin source, profile, and commands used. Do not record credentials.

## Fresh-Machine Interactive Flow

Verify:

1. Install Restish v2.3 or later.
2. Confirm the ZPan origin and local API name.
3. Connect `/api/openapi.json`.
4. Sync the API.
5. Approve installing `restish-zpan` from `saltbo/zpan`.
6. Run a safe reader operation and complete browser OAuth authorization code +
   PKCE consent.
7. List objects, upload a local file with `restish zpan-upload`, interrupt and
   resume one upload when practical, inspect the uploaded object, create a
   public share, revoke the share, and check quota.

## CI Flow

Verify:

1. Create a workspace-scoped Agent API key in ZPan settings.
2. Store it in `ZPAN_AGENT_API_KEY`.
3. Use the `ci` Restish profile without token copy/paste.
4. Run list and upload operations.
5. Attempt an operation outside the key scope and confirm `403`.

## Static Contract

Run the repository Skill contract check before release. It verifies the required
Restish setup, upload plugin, profile, safety, CI, and MCP guidance while
guarding against removed or unsafe v2.9 workflows.
