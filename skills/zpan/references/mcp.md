# Optional Restish MCP

Restish MCP is optional and only for reviewed ordinary OpenAPI operations. It is
not the upload transport. Local file uploads still use `restish zpan-upload`.

Default to read-only MCP:

```sh
restish plugin install rest-sh/restish mcp
restish mcp serve zpan --operations listObjects,getObject,listShares,getUserQuota,getStorageUsage
```

Enable write tools only after reviewing the exact operation allowlist. Do not
allow upload control-plane operation IDs through MCP.

Keep results bounded. Do not route file bytes, storage upload URLs, bearer
tokens, cookies, API keys, or checkpoint contents through MCP results.

Do not expose authentication, administration, billing, entitlement, membership,
or credential-management operations through MCP.
