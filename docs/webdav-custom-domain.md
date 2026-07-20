# WebDAV custom domains

ZPan always serves WebDAV internally at `/dav`. `WEBDAV_PUBLIC_URL` optionally exposes that mount at the root of a dedicated hostname while keeping the original `/dav/` endpoint available.

## Cloudflare Workers

In your fork, open **Settings → Secrets and variables → Actions → Variables** and add:

```text
WEBDAV_PUBLIC_URL=https://dav.example.com
```

The existing `CLOUDFLARE_API_TOKEN` also needs these zone permissions for the zone containing the hostname:

- `Zone:Read`
- `Transform Rules:Edit`

The production deployment discovers the matching Zone, creates a hostname-only Transform Rule, attaches the hostname as a Worker Custom Domain, and verifies the WebDAV authentication challenge. ZPan-owned rules use a `zpan_webdav_` ref prefix; the workflow does not replace or delete unrelated rules.

To change the hostname, update the variable and deploy. The old hostname is removed only after the new hostname passes verification. To disable it, delete the variable and deploy once; `/dav/` remains available.

The static-assets `run_worker_first` list is not widened. Normal application assets on the primary hostname continue to bypass the Worker, while requests to the dedicated DAV hostname are rewritten to `/dav` before Worker dispatch.

## Docker and other reverse proxies

Set the same runtime variable on the ZPan service:

```text
WEBDAV_PUBLIC_URL=https://dav.example.com
```

The reverse proxy in front of ZPan must:

1. Route the dedicated hostname to ZPan.
2. Internally prefix every request path with `/dav` without returning a redirect.
3. Preserve the original `Host`, HTTP method, query, body, and WebDAV headers such as `Destination`, `If`, `Depth`, `Overwrite`, and `Lock-Token`.

For example, an external request to `/Workspace/file.txt` must reach ZPan as `/dav/Workspace/file.txt` while the request hostname remains `dav.example.com`. ZPan then emits root-relative WebDAV resource addresses such as `/Workspace/file.txt`.

Without `WEBDAV_PUBLIC_URL`, clients should connect to `https://your-zpan.example/dav/` as before.
