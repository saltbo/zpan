# Preview license host policies

A signed license assertion may include `hostPolicy` with the shape
`{ "type": "worker-preview", "worker": "zpan", "account": "saltbo" }`.
It authorizes one complete DNS label ending in `-zpan`, under
`saltbo.workers.dev`. The preview prefix must be nonempty. Labels use ASCII DNS
syntax and are at most 63 characters. Case is ignored. Nested labels, the bare
Worker hostname, unrelated Worker suffixes, other accounts, suffix extensions and explicit
ports in the normalized host do not match. URL normalization removes default
ports. This is application authorization, independent of TLS wildcards. DNS names cannot distinguish a Preview of `zpan` from another Worker named `<prefix>-zpan` in the same account. Reserve that suffix in the account; the signed instance ID remains required.

Signature, issuer, instance, edition and validity checks still apply. Assertions
without this field retain exact `authorizedHosts` matching. An unknown or invalid
policy fails closed. Policy assertions carry an empty exact-host list so older
consumers reject them on paths that check a host. Older paths without a host check can still accept these assertions. Upgrade ZPan before enabling issuance.

Licensing HTTP responses, pairing verification and feature middleware use the
same host selection. Internal refresh reports also use the Preview request origin. Runtime feature gates use the configured Cloud URL as the trusted issuer, including signup and team hooks. Preview requests use the request URL host. Other requests
prefer the configured public origin. Preview mode alone grants no entitlement.

Cloud operators configure the policy for a specific test license and instance.
See Cloud's `docs/license-preview-hosts.md`. Deploy compatible ZPan validation
before enabling issuance. No database migration or SDK update is required because
the public SDK transports certificates as opaque strings.

Before release, verify pairing and token refresh from two real previews of the
same instance against staging, then verify a gated API and the licensing UI agree.
The expired staging license must be restored separately by an authorized operator.
This implementation does not renew it or authorize deployment.

Previews that share D1 also share refresh tokens. Avoid simultaneous manual refreshes; token rotation concurrency is an existing limitation and this change does not add coordination.

Self-hosted deployments must set `ZPAN_CLOUD_URL` to the origin that signs their license certificates. Feature gates now use this configured issuer consistently; a certificate from another Cloud origin is inactive. Commerce callback authorization remains limited to the latest refreshed exact Preview host.
