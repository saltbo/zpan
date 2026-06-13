import { performRefresh } from './license-refresh'
import type { CloudInstanceInfo, LicenseBindingRepo, LicensingCloudGateway } from './ports'

const DEDUP_WINDOW_SEC = 5 * 60

export type LicensingRefreshDeps = { licenseBinding: LicenseBindingRepo; licensingCloud: LicensingCloudGateway }

export async function runLicensingRefresh(
  deps: LicensingRefreshDeps,
  cloudBaseUrl: string,
  instance?: CloudInstanceInfo,
): Promise<void> {
  const state = await deps.licenseBinding.loadLicenseState()
  if (!state.refreshToken) return // unbound — no-op

  const nowSec = Math.floor(Date.now() / 1000)
  if (state.lastRefreshAt != null && nowSec - state.lastRefreshAt < DEDUP_WINDOW_SEC) return

  try {
    if (instance) {
      await performRefresh(deps, cloudBaseUrl, instance)
    } else {
      await performRefresh(deps, cloudBaseUrl)
    }
    console.log('licensing.refresh.ok')
  } catch (err) {
    const code = err instanceof Error ? err.message : String(err)
    console.error(`licensing.refresh.error code=${code}`)
  }
}
