import { verifyCertificate } from './license-certificate'
import { invalidateEntitlementCache } from './license-entitlement'
import {
  type CloudInstanceInfo,
  CloudInvalidResponseError,
  CloudNetworkError,
  CloudUnboundError,
  type LicenseBindingRepo,
  type LicensingCloudGateway,
} from './ports'

const INVALID_CERTIFICATE_ERROR = 'Invalid certificate from cloud'
const INVALID_ENTITLEMENT_RESPONSE_ERROR = 'Invalid entitlement response from cloud'

function normaliseCert(
  raw: string,
  options: { instanceId: string; cloudBaseUrl: string },
): { cert: string; certificateExpiresAt: number | null } {
  const assertion = verifyCertificate(raw, { instanceId: options.instanceId, cloudBaseUrl: options.cloudBaseUrl })
  return { cert: raw, certificateExpiresAt: assertion?.expiresAt ?? null }
}

export async function performRefresh(
  deps: { licensingCloud: LicensingCloudGateway; licenseBinding: LicenseBindingRepo },
  baseUrl: string,
  instance?: CloudInstanceInfo,
): Promise<void> {
  const state = await deps.licenseBinding.loadLicenseState()
  if (!state.refreshToken || !state.instanceId) return

  try {
    const data = await deps.licensingCloud.refreshEntitlement(baseUrl, state.refreshToken, instance)
    const { cert, certificateExpiresAt } = normaliseCert(data.certificate, {
      instanceId: state.instanceId,
      cloudBaseUrl: baseUrl,
    })
    if (!certificateExpiresAt) {
      await deps.licenseBinding.setLicenseRefreshError(state.id, INVALID_CERTIFICATE_ERROR)
      return
    }
    if (!data.binding?.storeId || !data.account) {
      await deps.licenseBinding.setLicenseRefreshError(state.id, INVALID_ENTITLEMENT_RESPONSE_ERROR)
      return
    }

    await deps.licenseBinding.updateLicenseBindingAfterRefresh({
      id: state.id,
      refreshToken: data.refreshToken,
      cloudStoreId: data.binding.storeId,
      cachedCert: cert,
      cachedExpiresAt: certificateExpiresAt,
      cloudAccountEmail: data.account.email,
      lastRefreshAt: Math.floor(Date.now() / 1000),
    })

    invalidateEntitlementCache()
  } catch (err) {
    if (err instanceof CloudUnboundError) {
      await deps.licenseBinding.clearLicenseBinding('revoked')
      invalidateEntitlementCache()
      return
    }

    if (err instanceof CloudInvalidResponseError || err instanceof CloudNetworkError || err instanceof Error) {
      await deps.licenseBinding.setLicenseRefreshError(state.id, err.message)
      return
    }

    throw err
  }
}
