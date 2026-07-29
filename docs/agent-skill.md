# ZPan Agent Skill

ZPan v2.9 publishes a versioned Agent Skill in [skills/zpan](../skills/zpan).
The Skill teaches coding agents to use ZPan through Restish and the
`restish-zpan` upload plugin.

## Install and Connect

Install Restish v2.3 or later, confirm the ZPan origin, then connect the single
unified OpenAPI document:

```sh
restish api connect zpan https://files.example.com/api/openapi.json --replace --yes
restish api sync zpan
```

Interactive agents use browser OAuth authorization code + PKCE through Restish.
CI and unattended jobs use the `ci` profile with `ZPAN_AGENT_API_KEY` from the
environment.

## Upload Plugin

Before installing the plugin, tell the user that Restish plugins are trusted
local executable code and ask them to approve the source:

```sh
restish plugin install saltbo/zpan zpan
```

Every local upload goes through:

```sh
restish --rsh-profile file-manager zpan-upload --api zpan --profile file-manager --parent root ./file.bin
```

The Skill does not implement upload transport logic. The plugin owns local file
streaming, storage response capture, retry, resume, abort, and checkpoint
cleanup.

## Profiles

- `reader`: read objects, shares, quota, and storage usage.
- `file-manager`: reader plus create, upload, move, copy, rename, and soft
  delete objects.
- `publisher`: reader plus public share creation and revocation.
- `ci`: environment-backed Agent API key for unattended file-management jobs.

The profile names are shortcuts for explicit scopes. They are not server-side
roles and routes do not authorize by preset name.

Interactive Restish login uses browser OAuth authorization code + PKCE.
