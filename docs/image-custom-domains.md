# Image custom domains

Image custom domains are available with a ZPan Pro or Business license. A site
administrator selects and tests one instance-wide provider in **Admin →
Settings → Image custom domains**. Workspace owners can bind domains only after
the provider reports **Ready**.

## Cloudflare for SaaS

Cloudflare for SaaS can route customer hostnames either to a ZPan Worker or to
an external ZPan origin such as Docker, Node.js, or another supported runtime.
The Worker field is required only in Worker mode.

Before configuring ZPan, the site administrator must:

1. Add a Cloudflare zone that will own the SaaS configuration. A dedicated zone
   is recommended.
2. Enable Cloudflare for SaaS / Custom Hostnames for that zone if it has not
   been enabled before.
3. Create the zone-scoped API token from the preconfigured link in the ZPan
   settings drawer.

This is a **runtime provider token**, not the `CLOUDFLARE_API_TOKEN` used by
GitHub Actions or Wrangler to deploy ZPan. The deployment token manages Worker,
D1, and R2 resources. The provider token is stored by ZPan and manages the
selected zone's DNS records, fallback origin, and Custom Hostnames.

### Worker mode

Choose this mode when the ZPan application is deployed as a Cloudflare Worker.

1. Open the preconfigured API-token link in the ZPan settings drawer.
2. Restrict the token to the zone used by this ZPan instance and create it.
3. Enter the token, zone ID, deployed Worker name, and a CNAME target inside
   that zone.
4. Save, then select **Set up and test**.

The token requires Zone Read plus DNS, SSL and Certificates, Zone Transform
Rules, and Workers Routes Edit permissions. ZPan uses it to create or reuse the
proxied CNAME target and fallback origin, install one managed URL rewrite rule,
and route only `*/ih/*` to the configured Worker. The rewrite adds `/ih`
internally, so customer image URLs remain clean and unrelated traffic does not
invoke the Worker.

### External origin mode

Choose this mode when ZPan is not served by a Worker. No Worker name or Workers
Routes permission is required.

1. Make the ZPan service reachable through HTTPS at a hostname inside the SaaS
   zone, for example `origin.saas.example.com`.
2. In Cloudflare DNS, create a proxied `A`, `AAAA`, or `CNAME` record for that
   origin hostname. The reverse proxy or application must accept requests whose
   original `Host` is a workspace's custom image domain.
3. Enter the provider token, zone ID, **External origin**, origin hostname, and
   a CNAME target inside the same zone.
4. Save, then select **Set up and test**.

The external-origin token requires Zone Read plus DNS and SSL and Certificates
Edit permissions. ZPan validates the proxied origin record, sets it as the
Cloudflare for SaaS fallback origin, creates or validates a proxied CNAME target
for it, and assigns the origin through `custom_origin_server` when provisioning
each Custom Hostname. It does not create a Worker route or URL rewrite rule.

In both modes, when a workspace binds a domain, ZPan creates its Cloudflare
Custom Hostname, refreshes DNS/TLS status, and removes it when the binding is
deleted. The workspace owner must still create the displayed CNAME at the
domain's authoritative DNS provider. Cloudflare then validates and issues the
certificate; this can take some time after DNS propagation.

## Self-managed

Use this provider when DNS and TLS terminate directly at the ZPan instance or
at infrastructure managed by the site administrator.

1. Enter one or more `CNAME`, `A`, or `AAAA` records that workspace owners must
   create.
2. Save and test the configuration.
3. Configure the reverse proxy or runtime so requests for customer domains
   reach the same ZPan instance.

Each workspace binding receives a unique HTTP challenge path. After DNS takes
effect, requesting that path through the custom domain proves that the request
reaches the correct ZPan instance. ZPan then activates image routing for that
domain.

Changing or disabling the provider invalidates every existing binding.
Re-enabling or changing providers requires another successful provider test,
which reprovisions all existing domains under the selected provider.

If a license is downgraded below Pro, existing image URLs continue to resolve,
but administrators cannot change or retest the provider and workspace owners
cannot add or replace a custom domain. Existing bindings can still be removed.
