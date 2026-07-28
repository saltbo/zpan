# Image custom domains

ZPan supports instance-wide, self-managed providers for workspace image-hosting
domains. A site administrator selects and tests one provider in **Admin →
Settings → Image custom domains**. Workspace owners can bind domains only after
the provider reports **Ready**.

## Cloudflare for SaaS

Use this provider when the ZPan instance already has Cloudflare for SaaS
configured on a zone.

1. Configure a fallback origin in Cloudflare for SaaS.
2. Create a scoped API token that can read the zone and manage Custom Hostnames.
3. Enter the token, zone ID, and customer CNAME target in ZPan.
4. Save and test the configuration.

ZPan creates a Cloudflare Custom Hostname when a workspace binds a domain,
periodically refreshes DNS/TLS status, and removes the Custom Hostname when the
binding is deleted. ZPan does not create the fallback origin, DNS records, or
Worker routes.

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
