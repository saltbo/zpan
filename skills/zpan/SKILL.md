---
name: zpan
description: Manage ZPan files through Restish v2.3+ and the trusted restish-zpan upload plugin.
version: 2.9.0
---

# ZPan Agent Skill

Use this Skill when an agent needs to browse, inspect, move, copy, delete,
upload, download, share, revoke shares, check quota, or inspect background
tasks on a ZPan instance.

## Operating Boundary

ZPan file management uses two surfaces:

- Generated Restish OpenAPI commands for ordinary API operations.
- `restish zpan-upload` from the `restish-zpan` plugin for every local file
  upload.

Do not read local file bytes, orchestrate upload parts, handle storage response
tags, loop part retries, or expose storage upload URLs. The upload plugin owns
local file streaming, upload state, storage response capture, retry, resume,
abort, and checkpoint cleanup.

## Start Here

1. Confirm the ZPan origin with the user before connecting or mutating data.
2. Confirm the Restish API name. Use `zpan` unless the user already has a
   different local API name.
3. Require Restish v2.3 or later.
4. Connect exactly one OpenAPI document: `<origin>/api/openapi.json`.
5. Select the least-privilege profile that fits the task:
   `reader`, `file-manager`, `publisher`, or `ci`.
6. Sync the Restish API before use when it was connected previously.

Use [references/setup.md](references/setup.md) for install, connect, sync, and
profile selection.

## Workflow Routing

- Browsing, inspecting, folders, move/copy/rename, delete, download links,
  shares, quota, and tasks: use [references/file-workflows.md](references/file-workflows.md).
- Local uploads: use [references/uploads.md](references/uploads.md).
- CI or unattended automation with an Agent API key:
  use [references/ci.md](references/ci.md).
- Optional MCP transport for reviewed ordinary operations:
  use [references/mcp.md](references/mcp.md).
- Release or preview acceptance evidence:
  use [references/acceptance.md](references/acceptance.md).

## Safety Rules

Confirm before:

- choosing a target workspace;
- overwriting, replacing, or retrying conflict handling;
- soft deleting files or folders;
- permanently purging trash;
- creating public shares;
- installing executable Restish plugins.

Never ask the user to paste a bearer token. Interactive use goes through
browser OAuth authorization code + PKCE. CI use relies on an environment-backed
Agent API key profile.

Keep results bounded. Prefer compact object IDs, names, paths, URLs, quota
effects, task state, and upload state over full raw responses.
