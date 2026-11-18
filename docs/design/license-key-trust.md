# License key trust

ZPan verifies Cloud entitlement certificates (PASETO v4) locally. The keys it
trusts are hardcoded in [`server/domain/license-keys.ts`](../../server/domain/license-keys.ts);
no environment variable or other runtime setting adds or replaces a key.

## Key scopes

Every builtin key is a record with a fixed scope:

| Key | Issuer | Hosts |
| --- | --- | --- |
| production | `https://cloud.zpan.space` | exact `authorizedHosts` only |
| staging | `https://staging-zpan-cloud.saltbo.workers.dev` | every host must be exactly `<one-label>.saltbo.workers.dev` |
| dev | a loopback origin (`localhost`, `127.0.0.1`, `[::1]`, any port) | `localhost`, `127.0.0.1`, `[::1]` only (any port) |

A certificate is valid only if all of these hold:

1. its signature verifies with a builtin key;
2. its `issuer` equals that key's issuer scope;
3. its `issuer` equals the configured Cloud origin (`ZPAN_CLOUD_URL`, default
   production);
4. every entry of `authorizedHosts` is a well-formed host inside the key's host
   scope, and the current host (when checked) is one of those exact entries and
   inside the scope.

Hosts are matched exactly. There is no wildcard or pattern matching; a
`hostPolicy` claim is ignored and only `authorizedHosts` applies. Cloud event
tokens (store delivery) are also bound to the signing key's issuer scope.

## Current host selection

Licensing HTTP responses, pairing verification and feature middleware share one
host selection (`server/middleware/license-host.ts`): Preview requests use the
request URL host; other requests prefer the configured public origin, then the
`Host` header. Runtime feature gates use the configured Cloud URL as the trusted
issuer, including signup and team hooks. Internal refresh reports use the Preview
request origin.

## Previews

Worker Previews pair with staging Cloud, which issues each Preview a certificate
whose `authorizedHosts` holds that Preview's exact hostname. The staging key scope
keeps such certificates confined to single-label `saltbo.workers.dev` hosts.

## Tests

Tests trust throwaway keys only through `trustLicenseKeyForTesting` (see
`server/test/license-keys.ts`). The E2E servers load
`e2e/server/trust-cloud-fake-key.ts` from E2E-only entries; production entries
never import it.

## Rotation

Add the new key with its scope and ship ZPan; switch Cloud's `LICENSE_SIGNING_KEY`;
after 24 h (old certificates expired) remove the old key and ship again.
