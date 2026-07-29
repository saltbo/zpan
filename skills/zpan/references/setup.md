# ZPan Restish Setup

## Confirm Origin and API Name

Before connecting, ask the user to confirm:

- the ZPan origin, for example `https://files.example.com`;
- the local Restish API name, normally `zpan`;
- the intended workspace if the next operation reads or changes workspace data.

Use one OpenAPI document only:

```sh
restish api connect zpan https://files.example.com/api/openapi.json --replace --yes
```

The `--yes` here approves replacing the Restish API connection after the user
has confirmed the origin. It does not approve plugin installation.

For an existing connection, sync before use:

```sh
restish api sync zpan
```

## Restish Version

Require Restish v2.3 or later:

```sh
restish --version
```

Stop and ask the user to upgrade if the version is older than v2.3.

## Profiles and Scopes

Reader, File manager, and Publisher are Restish convenience profiles that
expand to explicit scopes. They are not server-side roles or route names.

| Profile | Use for | Scope set |
| --- | --- | --- |
| `reader` | Browse, inspect, download links, quota | `objects:read`, `shares:read`, `quota:read`, `storage-usage:read` |
| `file-manager` | Reader plus create folders, upload, move, copy, rename, soft delete | Reader scopes plus `objects:create`, `objects:update`, `objects:delete` |
| `publisher` | Reader plus create and revoke public shares | Reader scopes plus `shares:create`, `shares:delete` |
| `ci` | Unattended file-management automation | Environment-backed `agentApiKey` with file-manager scopes |

Prefer the narrowest profile:

```sh
restish --rsh-profile reader zpan listObjects
restish --rsh-profile file-manager zpan listObjects
restish --rsh-profile publisher zpan listShares
```

The first safe OAuth-backed command may open the browser for authorization code
+ PKCE consent. Restish owns token storage, refresh, logout, and redacted auth
diagnostics.

Use `--rsh-no-browser` only when the authorization-code callback can still be
completed manually.

## Upload Plugin Trust Gate

Install `restish-zpan` only after telling the user that Restish plugins are
trusted local executable code and asking them to approve this source:

```sh
restish plugin install saltbo/zpan zpan
```

Do not add a silent approval flag to plugin installation. After installation,
confirm that `restish zpan-upload` is available before using upload workflows.
