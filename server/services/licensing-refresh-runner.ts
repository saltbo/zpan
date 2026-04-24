// Shared entitlement refresh runner — called from all entry points
// (CF scheduled, Node interval, REST cron endpoint).
//
// Guards:
//   - Unbound (no licenseBinding row): no-op
//   - last_refresh_at within 5 minutes: skip (deduplication)

import { eq } from 'drizzle-orm'
import { licenseBinding } from '../db/schema'
import { performRefresh } from '../licensing/refresh'
import type { Database } from '../platform/interface'

const DEDUP_WINDOW_SEC = 5 * 60 // 5 minutes

export async function runLicensingRefresh(db: Database, cloudBaseUrl: string): Promise<void> {
  const rows = await db
    .select({ lastRefreshAt: licenseBinding.lastRefreshAt })
    .from(licenseBinding)
    .where(eq(licenseBinding.id, 1))
    .limit(1)

  const row = rows[0]
  if (!row) return // unbound — no-op

  const nowSec = Math.floor(Date.now() / 1000)
  if (row.lastRefreshAt != null && nowSec - row.lastRefreshAt < DEDUP_WINDOW_SEC) return

  try {
    await performRefresh(db, cloudBaseUrl)
    console.log('licensing.refresh.ok')
  } catch (err) {
    const code = err instanceof Error ? err.message : String(err)
    console.error(`licensing.refresh.error code=${code}`)
  }
}
