// E2E-only: trusts the signing key of scripts/zpan-cloud-fake.mjs. Imported solely
// by the E2E server entries in this directory; production entries never load it and
// no configuration value can enable it. The key carries the dev scope (loopback
// issuer and hosts), matching the fake Cloud on 127.0.0.1.
import { trustLicenseKeyForTesting } from '../../server/domain/license-keys'

trustLicenseKeyForTesting({
  name: 'e2e-cloud-fake',
  publicKey: 'k4.public.H2gYKGNtxgWbMuwgPdDuHoM_sOLzFC-khe23pz2IZfM',
  issuer: { kind: 'loopback' },
  hosts: { kind: 'loopback' },
})
