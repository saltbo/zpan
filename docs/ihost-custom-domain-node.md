# Image Hosting — Custom Domain (Node / Docker self-host)

When running ZPan on Node.js (Docker) without Cloudflare Workers, custom domain SSL termination is handled by your own reverse proxy. ZPan does **not** manage DNS or certificates automatically in this mode — it simply stores the configured domain and serves images if requests arrive with the matching `Host` header.

## Caddy example

Add a reverse-proxy block to your `Caddyfile` (replace `img.example.com` with your domain and `127.0.0.1:3000` with your ZPan server address):

```caddy
img.example.com {
  reverse_proxy 127.0.0.1:3000
}
```

Caddy obtains a Let's Encrypt certificate automatically.

## DNS

Point your custom domain to your server IP:

```
img.example.com.  A  <your-server-ip>
```

## ZPan config

Set the custom domain via the API or web UI. The `domainStatus` field will remain `pending` (no automatic verification on Node) but images will be served correctly once DNS propagates and the reverse proxy is in place.
