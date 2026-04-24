// Cloud public keys for verifying PASETO v4 entitlement certificates.
//
// ZPan verifies every entitlement certificate against this list.
// Multiple keys are supported to allow zero-downtime key rotation:
//   1. Add the new key here and deploy ZPan.
//   2. Update the cloud Worker secret (LICENSE_SIGNING_KEY) to the new key and deploy.
//   3. After 24 h (old certs expired), remove the old key here and deploy ZPan again.
//
// Keys are PASERK k4.public.* strings (Ed25519, 32 raw bytes, base64url-encoded).
export const PUBLIC_KEYS: string[] = [
  // cloud.zpan.space production key — provisioned 2026-04-23
  'k4.public.sphdaogcyIh2_6_yZnO4_xQsi2m52HH9j2CPHcKlGGw',
]
