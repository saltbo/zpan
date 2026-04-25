import { loadLicenseState } from '../licensing/license-state'
import { performRefresh } from '../licensing/refresh'
import type { Database } from '../platform/interface'

const DEDUP_WINDOW_SEC = 5 * 60

export async function runLicensingRefresh(db: Database, cloudBaseUrl: string): Promise<void> {
  const state = await loadLicenseState(db)
  if (!state.refreshToken) return // unbound — no-op

  const nowSec = Math.floor(Date.now() / 1000)
  if (state.lastRefreshAt != null && nowSec - state.lastRefreshAt < DEDUP_WINDOW_SEC) return

  try {
    await performRefresh(db, cloudBaseUrl)
    console.log('licensing.refresh.ok')
  } catch (err) {
    const code = err instanceof Error ? err.message : String(err)
    console.error(`licensing.refresh.error code=${code}`)
  }
}
