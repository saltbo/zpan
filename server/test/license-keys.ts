import { ZPAN_CLOUD_URL_DEFAULT } from '../../shared/constants'
import { trustLicenseKeyForTesting, untrustLicenseKeyForTesting } from '../domain/license-keys'

// Trusts a throwaway test signing key for the given cloud issuers (exact host
// matching), through the test-only hook in domain/license-keys.
export function trustTestLicenseKey(publicKey: string, issuers: readonly string[] = [ZPAN_CLOUD_URL_DEFAULT]): void {
  for (const origin of issuers) {
    trustLicenseKeyForTesting({ name: 'test', publicKey, issuer: { kind: 'exact', origin }, hosts: { kind: 'exact' } })
  }
}

export { untrustLicenseKeyForTesting as untrustTestLicenseKey }
