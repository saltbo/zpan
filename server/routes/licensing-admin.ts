import { eq } from 'drizzle-orm'
import { Hono } from 'hono'
import { ZPAN_CLOUD_URL_DEFAULT } from '../../shared/constants'
import { systemOptions } from '../db/schema'
import { invalidateEntitlementCache } from '../licensing/entitlement'
import { getOrCreateInstanceId } from '../licensing/instance-id'
import { clearLicenseBinding, createLicenseBinding, loadLicenseState } from '../licensing/license-state'
import { performRefresh } from '../licensing/refresh'
import { normalizeHost, verifyCertificate } from '../licensing/verify'
import { requireAdmin } from '../middleware/auth'
import type { Env } from '../middleware/platform'
import { recordActivity } from '../services/activity'
import { createPairing, pollPairing, refreshEntitlement } from '../services/licensing-cloud'

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

function getRequestHost(c: { req: { url: string; header(name: string): string | undefined } }): string {
  const forwardedHost = c.req.header('x-forwarded-host') ?? c.req.header('host')
  return normalizeHost(forwardedHost) ?? new URL(c.req.url).host
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
      const entitlement = result.store_key
        ? {
            refreshToken: result.refresh_token,
            storeKey: result.store_key,
            certificate: result.certificate,
            binding: result.binding,
            account: result.account,
          }
        : await loadInitialEntitlement(baseUrl, result.refresh_token).catch(() => null)
      if (!entitlement) return c.json({ error: 'invalid_pairing_response' }, 502)
      const instanceId = await getOrCreateInstanceId(db)
      const cert = entitlement.certificate
      const assertion = verifyCertificate(cert, {
        instanceId,
        currentHost: getRequestHost(c),
        cloudBaseUrl: baseUrl,
      })
      if (!assertion || !entitlement.binding || !entitlement.account) {
        return c.json({ error: 'invalid_certificate' }, 502)
      }

      await createLicenseBinding(db, {
        cloudBindingId: entitlement.binding.id,
        instanceId,
        cloudAccountId: entitlement.account.id,
        cloudAccountEmail: entitlement.account.email,
        refreshToken: entitlement.refreshToken,
        storeKey: entitlement.storeKey,
        cachedCert: cert,
        cachedExpiresAt: assertion.expiresAt,
        lastRefreshAt: Math.floor(Date.now() / 1000),
      })

      invalidateEntitlementCache()

      const userId = c.get('userId')!
      const orgId = c.get('orgId')!
      await recordActivity(db, {
        orgId,
        userId,
        action: 'license_pair',
        targetType: 'license',
        targetName: entitlement.account.email ?? entitlement.account.id,
        metadata: { edition: assertion.edition, cloudAccountId: entitlement.account.id },
      })

      return c.json({
        status: 'approved' as const,
        edition: assertion.edition,
      })
    }

    if (result.status === 'approved') {
      return c.json({ error: 'invalid_pairing_response' }, 502)
    }

    return c.json({ status: result.status })
  })

  .post('/refresh', async (c) => {
    const db = c.get('platform').db
    const userId = c.get('userId')!
    const orgId = c.get('orgId')!
    const baseUrl = getCloudBaseUrl(c)

    await performRefresh(db, baseUrl)

    const state = await loadLicenseState(db)

    await recordActivity(db, {
      orgId,
      userId,
      action: 'license_refresh',
      targetType: 'license',
      targetName: 'license binding',
    })

    return c.json({ success: true, last_refresh_at: state.lastRefreshAt })
  })

  .delete('/binding', async (c) => {
    const db = c.get('platform').db
    const userId = c.get('userId')!
    const orgId = c.get('orgId')!

    await clearLicenseBinding(db)
    invalidateEntitlementCache()

    await recordActivity(db, {
      orgId,
      userId,
      action: 'license_disconnect',
      targetType: 'license',
      targetName: 'license binding',
    })

    return c.json({ deleted: true })
  })

export default app

async function loadInitialEntitlement(baseUrl: string, refreshToken: string) {
  const data = await refreshEntitlement(baseUrl, refreshToken)
  return {
    refreshToken: data.refresh_token,
    storeKey: data.store_key,
    certificate: data.certificate,
    binding: data.binding,
    account: data.account,
  }
}
