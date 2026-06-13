import { performRefresh } from '../licensing/refresh'
import type { Database } from '../platform/interface'
import type { CloudInstanceInfo, LicenseBindingRepo } from './ports'

const DEDUP_WINDOW_SEC = 5 * 60

export type LicensingRefreshDeps = { licenseBinding: LicenseBindingRepo }

export async function runLicensingRefresh(
  deps: LicensingRefreshDeps,
  db: Database,
  cloudBaseUrl: string,
  instance?: CloudInstanceInfo,
): Promise<void> {
  const state = await deps.licenseBinding.loadLicenseState()
  if (!state.refreshToken) return // unbound — no-op

  const nowSec = Math.floor(Date.now() / 1000)
  if (state.lastRefreshAt != null && nowSec - state.lastRefreshAt < DEDUP_WINDOW_SEC) return

  try {
    if (instance) {
      await performRefresh(db, cloudBaseUrl, instance)
    } else {
      await performRefresh(db, cloudBaseUrl)
    }
    console.log('licensing.refresh.ok')
  } catch (err) {
    const code = err instanceof Error ? err.message : String(err)
    console.error(`licensing.refresh.error code=${code}`)
  }
}
