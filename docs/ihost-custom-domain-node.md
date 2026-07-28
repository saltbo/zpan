# Image Hosting — Custom Domain (Node / Docker self-host)

Image custom domains require ZPan Pro or Business. When running ZPan on Node.js
or Docker without Cloudflare Workers, choose one of these provider modes:

- **Self-managed**: your reverse proxy terminates TLS and sends the original
  custom-domain `Host` to ZPan. ZPan verifies the binding through its generated
  HTTP challenge path.
- **Cloudflare for SaaS → External origin**: Cloudflare manages customer
  certificates and sends requests to a proxied ZPan origin hostname. No Worker
  name is required.

## Self-managed example

Add a reverse-proxy block to your `Caddyfile` (replace `img.example.com` with your domain and `127.0.0.1:3000` with your ZPan server address):

```caddy
img.example.com {
  reverse_proxy 127.0.0.1:3000
}
```

Caddy obtains a Let's Encrypt certificate automatically.

Point the custom domain to the server:

```dns
img.example.com.  A  <your-server-ip>
```

In **Admin → Settings → Image custom domains**, select **Self-managed**, enter
the DNS records owners should create, save, and test the provider. A workspace
owner can then enter the domain in image-hosting settings. ZPan displays a
unique challenge path and marks the binding verified after that path reaches
the same ZPan instance through the custom domain.

## Cloudflare for SaaS external origin

1. Expose ZPan through HTTPS at an origin hostname inside the selected
   Cloudflare SaaS zone, for example `origin.saas.example.com`.
2. Create a proxied `A`, `AAAA`, or `CNAME` record for that hostname in
   Cloudflare DNS. Configure the reverse proxy to preserve the incoming
   customer `Host` header.
3. In ZPan, select **Cloudflare for SaaS** and **External origin**, then enter
   the zone-scoped provider API token, zone ID, origin hostname, and customer
   CNAME target.
4. Save and run **Set up and test**.

ZPan configures the origin as the Cloudflare for SaaS fallback origin and uses
it as each Custom Hostname's `custom_origin_server`. Workspace owners only need
to create the CNAME shown in their settings; Cloudflare handles hostname
validation and TLS. See [Image custom domains](image-custom-domains.md) for
token permissions and the distinction between deployment and provider tokens.
