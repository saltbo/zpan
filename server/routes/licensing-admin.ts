import { eq } from 'drizzle-orm'
import { Hono } from 'hono'
import { ZPAN_CLOUD_URL_DEFAULT } from '../../shared/constants'
import { systemOptions } from '../db/schema'
import { invalidateEntitlementCache } from '../licensing/entitlement'
import { getOrCreateInstanceId } from '../licensing/instance-id'
import { clearLicenseBinding, LICENSE_KEYS, loadLicenseState, setLicenseOptions } from '../licensing/license-state'
import { performRefresh } from '../licensing/refresh'
import { verifyCertificate } from '../licensing/verify'
import { requireAdmin } from '../middleware/auth'
import type { Env } from '../middleware/platform'
import { createPairing, pollPairing } from '../services/licensing-cloud'

function getCloudBaseUrl(c: { get(key: 'platform'): { getEnv(k: string): string | undefined } }): string {
  return c.get('platform').getEnv('ZPAN_CLOUD_URL') ?? ZPAN_CLOUD_URL_DEFAULT
}

const app = new Hono<Env>()
  .use(requireAdmin)

  .post('/pair', async (c) => {
    const db = c.get('platform').db
    const baseUrl = getCloudBaseUrl(c)

    const instanceId = await getOrCreateInstanceId(db)

    const titleRows = await db
      .select({ value: systemOptions.value })
      .from(systemOptions)
      .where(eq(systemOptions.key, 'site_title'))
      .limit(1)

    const instanceName = titleRows[0]?.value ?? 'ZPan'
    const instanceHost = c.req.header('host') ?? new URL(c.req.url).host

    const pairing = await createPairing(baseUrl, instanceId, instanceName, instanceHost)
    return c.json(pairing)
  })

  .get('/pair/:code/poll', async (c) => {
    const { code } = c.req.param()
    const db = c.get('platform').db
    const baseUrl = getCloudBaseUrl(c)

    const result = await pollPairing(baseUrl, code)

    if (result.status === 'approved' && result.refresh_token && result.entitlement != null) {
      const instanceId = await getOrCreateInstanceId(db)

      let cert: string
      let expiresAt: number | null = null

      if (typeof result.entitlement === 'string') {
        cert = result.entitlement
        const entitlement = verifyCertificate(cert, instanceId)
        if (entitlement) {
          expiresAt = Math.floor(new Date(entitlement.expires_at).getTime() / 1000)
        }
      } else {
        cert = JSON.stringify(result.entitlement)
        const parsed = result.entitlement as { expires_at?: string }
        if (parsed.expires_at) {
          expiresAt = Math.floor(new Date(parsed.expires_at).getTime() / 1000)
        }
      }

      const nowSec = String(Math.floor(Date.now() / 1000))
      await setLicenseOptions(db, {
        [LICENSE_KEYS.instanceId]: instanceId,
        [LICENSE_KEYS.refreshToken]: result.refresh_token,
        [LICENSE_KEYS.cachedCert]: cert,
        [LICENSE_KEYS.cachedExpiresAt]: expiresAt ? String(expiresAt) : null,
        [LICENSE_KEYS.lastRefreshAt]: nowSec,
        [LICENSE_KEYS.boundAt]: nowSec,
      })

      invalidateEntitlementCache()

      return c.json({
        status: 'approved' as const,
        plan: getPlanFromCert(cert, instanceId),
      })
    }

    return c.json({ status: result.status })
  })

  .post('/refresh', async (c) => {
    const db = c.get('platform').db
    const baseUrl = getCloudBaseUrl(c)

    await performRefresh(db, baseUrl)

    const state = await loadLicenseState(db)
    return c.json({ success: true, last_refresh_at: state.lastRefreshAt })
  })

  .delete('/binding', async (c) => {
    const db = c.get('platform').db

    await clearLicenseBinding(db)
    invalidateEntitlementCache()

    return c.json({ deleted: true })
  })

function getPlanFromCert(cert: string, instanceId: string): string | undefined {
  if (cert.startsWith('v4.public.')) {
    const entitlement = verifyCertificate(cert, instanceId)
    return entitlement?.plan
  }

  try {
    const parsed = JSON.parse(cert) as { plan?: string }
    return parsed.plan
  } catch {
    return undefined
  }
}

export default app
