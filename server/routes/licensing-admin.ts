import { eq } from 'drizzle-orm'
import { Hono } from 'hono'
import { ZPAN_CLOUD_URL_DEFAULT } from '../../shared/constants'
import { licenseBinding, systemOptions } from '../db/schema'
import { invalidateEntitlementCache } from '../licensing/entitlement'
import { getOrCreateInstanceId } from '../licensing/instance-id'
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

  // POST /api/licensing/pair — initiate device-code pairing with cloud
  .post('/pair', async (c) => {
    const db = c.get('platform').db
    const baseUrl = getCloudBaseUrl(c)

    const instanceId = await getOrCreateInstanceId(db)

    // Read site_title for instance_name; fall back to host header
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

  // GET /api/licensing/pair/:code/poll — proxy poll to cloud
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
        // Pre-C5 plain object — store as JSON
        // TODO: assert PASETO string once C5 lands; remove this branch
        cert = JSON.stringify(result.entitlement)
      }

      await db
        .insert(licenseBinding)
        .values({
          id: 1,
          instanceId,
          refreshToken: result.refresh_token,
          cachedCert: cert,
          cachedExpiresAt: expiresAt,
          lastRefreshAt: Math.floor(Date.now() / 1000),
          boundAt: Math.floor(Date.now() / 1000),
        })
        .onConflictDoUpdate({
          target: licenseBinding.id,
          set: {
            refreshToken: result.refresh_token,
            cachedCert: cert,
            cachedExpiresAt: expiresAt,
            lastRefreshAt: Math.floor(Date.now() / 1000),
            boundAt: Math.floor(Date.now() / 1000),
          },
        })

      invalidateEntitlementCache()

      const stateRows = await db.select().from(licenseBinding).where(eq(licenseBinding.id, 1)).limit(1)
      const row = stateRows[0]

      return c.json({
        status: 'approved' as const,
        plan: row?.cachedCert ? getPlanFromCert(row.cachedCert) : undefined,
      })
    }

    return c.json({ status: result.status })
  })

  // POST /api/licensing/refresh — force an entitlement refresh
  .post('/refresh', async (c) => {
    const db = c.get('platform').db
    const baseUrl = getCloudBaseUrl(c)

    await performRefresh(db, baseUrl)

    const rows = await db.select({ lastRefreshAt: licenseBinding.lastRefreshAt }).from(licenseBinding).limit(1)
    const lastRefreshAt = rows[0]?.lastRefreshAt ?? null

    return c.json({ success: true, last_refresh_at: lastRefreshAt })
  })

  // DELETE /api/licensing/binding — local unbind (does NOT call cloud)
  .delete('/binding', async (c) => {
    const db = c.get('platform').db

    await db.delete(licenseBinding).where(eq(licenseBinding.id, 1))
    invalidateEntitlementCache()

    return c.json({ deleted: true })
  })

function getPlanFromCert(cert: string): string | undefined {
  // PASETO token — can't parse without verify; return undefined for now
  if (cert.startsWith('v4.public.')) return undefined

  try {
    const parsed = JSON.parse(cert) as { plan?: string }
    return parsed.plan
  } catch {
    return undefined
  }
}

export default app
