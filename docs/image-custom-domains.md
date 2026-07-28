# Image custom domains

ZPan supports instance-wide, self-managed providers for workspace image-hosting
domains. A site administrator selects and tests one provider in **Admin →
Settings → Image custom domains**. Workspace owners can bind domains only after
the provider reports **Ready**.

## Cloudflare for SaaS

Use this provider when the ZPan Worker and its customer image domains are served
through a Cloudflare zone.

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

When a workspace binds a domain, ZPan also creates its Cloudflare Custom
Hostname, refreshes DNS/TLS status, and removes it when the binding is deleted.
The workspace owner still needs to create the displayed CNAME at their
authoritative DNS provider. Enabling Cloudflare for SaaS for the zone for the
first time remains an account-level Cloudflare action.

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
