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

function getInstanceOrigin(c: { req: { url: string; header(name: string): string | undefined } }): string {
  const requestUrl = new URL(c.req.url)
  const forwardedProto = c.req.header('x-forwarded-proto')
  const forwardedHost = c.req.header('x-forwarded-host') ?? c.req.header('host')

  if (forwardedProto && forwardedHost) {
    return `${forwardedProto}://${forwardedHost}`
  }

  return requestUrl.origin
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
    const instanceHost = getInstanceOrigin(c)

    const pairing = await createPairing(baseUrl, instanceId, instanceName, instanceHost)
    return c.json(pairing)
  })

  .get('/pair/:code/poll', async (c) => {
    const { code } = c.req.param()
    const db = c.get('platform').db
    const baseUrl = getCloudBaseUrl(c)

    const result = await pollPairing(baseUrl, code)

    if (result.status === 'approved' && result.refresh_token && result.certificate) {
      const instanceId = await getOrCreateInstanceId(db)
      const cert = result.certificate
      const entitlement = verifyCertificate(cert, instanceId)
      if (!entitlement) {
        return c.json({ error: 'invalid_certificate' }, 502)
      }
      const expiresAt = Math.floor(new Date(entitlement.expires_at).getTime() / 1000)

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
        plan: entitlement.plan,
      })
    }

    if (result.status === 'approved') {
      return c.json({ error: 'invalid_pairing_response' }, 502)
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

export default app
