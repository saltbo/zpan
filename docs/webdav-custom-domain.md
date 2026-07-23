# WebDAV domain

When WebDAV is enabled, ZPan serves it internally at `/dav`. By default, the dedicated hostname is derived by prepending `dav.` to the hostname in Admin Settings → Public URL. For example, `https://files.example.com` produces `https://dav.files.example.com/`. Set a different hostname in **Admin Settings → WebDAV → Domain** when needed. The value must be a hostname without a protocol, port, or path. The original `/dav/` endpoint remains available.

Until that exact derived origin has been verified, the public `configz` document and user-facing WebDAV setup page continue to advertise the `/dav/` URL. Verification status is shown under **Admin Settings → WebDAV**. Changing Public URL invalidates the previous verification automatically.

## Cloudflare Workers

Set the primary site hostname as a Worker Custom Domain and configure the same origin as **Public URL** in ZPan Admin Settings. The existing `CLOUDFLARE_API_TOKEN` also needs `Transform Rules:Edit` for that zone.

The production deployment finds the primary Custom Domain already attached to the `zpan` Worker, derives its `dav.` hostname, creates a hostname-only Transform Rule, attaches the derived hostname as another Worker Custom Domain, and verifies the WebDAV authentication challenge. For a custom hostname configured in Admin Settings, configure that hostname as a Worker Custom Domain and add an equivalent rewrite from its root to `/dav`; the current deployment workflow only automates the derived `dav.` hostname. After verification succeeds, ZPan records that exact origin in D1 so it can advertise it. ZPan-owned rules use a `zpan_webdav_` ref prefix; the workflow does not replace or delete unrelated rules.

If the Worker has no primary Custom Domain, the deployment skips the dedicated hostname and `/dav/` remains available. If it has multiple possible primary Custom Domains, deployment fails instead of choosing one arbitrarily.

The static-assets `run_worker_first` list is not widened. Normal application assets on the primary hostname continue to bypass the Worker, while requests to the dedicated DAV hostname are rewritten to `/dav` before Worker dispatch.

## Docker and other reverse proxies

Configure the main origin as **Public URL** in ZPan Admin Settings. If it is `https://files.example.com`, configure the reverse proxy in front of ZPan to serve `dav.files.example.com`, or the custom WebDAV domain configured in Admin Settings, and:

1. Route the dedicated hostname to ZPan.
2. Internally prefix every request path with `/dav` without returning a redirect.
3. Preserve the original `Host`, HTTP method, query, body, and WebDAV headers such as `Destination`, `If`, `Depth`, `Overwrite`, and `Lock-Token`.

After configuring DNS and the proxy, open **Admin Settings → WebDAV** and select **Verify domain**. The server sends an unauthenticated `OPTIONS` request and accepts the domain only when it receives ZPan's WebDAV authentication challenge. This verification works the same way for Docker, Lambda, Vercel, Netlify, Azure, Cloud Run, and other deployments; it does not configure the external proxy for you.

For example, an external request to `/Workspace/file.txt` must reach ZPan as `/dav/Workspace/file.txt` while the request hostname remains `dav.files.example.com`. ZPan then emits root-relative WebDAV resource addresses such as `/Workspace/file.txt`.

Without the dedicated proxy hostname, clients can still connect to `https://your-zpan.example/dav/`.
