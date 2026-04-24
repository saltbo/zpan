import { verify } from 'paseto-ts/v4'
import type { LicenseEntitlement } from '@shared/types'
import { PUBLIC_KEYS } from './public-keys'

// Attempt to verify a PASETO v4.public cert against each known public key.
// Returns the parsed entitlement only when ALL of the following hold:
//   1. Signature is valid for one of the PUBLIC_KEYS
//   2. expires_at has not passed
//   3. instance_id matches the provided instanceId
// Returns null (never throws) for any invalid cert so feature gates silently lock.
export function verifyCertificate(cert: string, instanceId: string): LicenseEntitlement | null {
  for (const key of PUBLIC_KEYS) {
    const entitlement = tryVerify(cert, key, instanceId)
    if (entitlement !== null) {
      return entitlement
    }
  }
  return null
}

function tryVerify(cert: string, publicKey: string, instanceId: string): LicenseEntitlement | null {
  try {
    const { payload } = verify<LicenseEntitlement>(publicKey, cert, { validatePayload: false })

    if (new Date(payload.expires_at) <= new Date()) {
      return null
    }

    if (payload.instance_id !== instanceId) {
      return null
    }

    return {
      account_id: payload.account_id,
      instance_id: payload.instance_id,
      plan: payload.plan,
      features: payload.features,
      issued_at: payload.issued_at,
      expires_at: payload.expires_at,
    }
  } catch {
    return null
  }
}
