import { Hono } from 'hono'
import { ZPAN_CLOUD_URL_DEFAULT } from '../../shared/constants'
import { originFromRequestUrl } from '../domain/site-public-origin'
import { invalidateEntitlementCache } from '../licensing/entitlement'
import { buildCloudInstanceInfo, runtimeInfo } from '../licensing/instance-info'
import { performRefresh } from '../licensing/refresh'
import { normalizeHost, verifyCertificateResult } from '../licensing/verify'
import { requireAdmin } from '../middleware/auth'
import type { Env } from '../middleware/platform'
import type { PairingPollResponse } from '../usecases/ports'
import { getSitePublicOrigin } from '../usecases/site-public-origin'

function getCloudBaseUrl(c: { get(key: 'platform'): { getEnv(k: string): string | undefined } }): string {
  return c.get('platform').getEnv('ZPAN_CLOUD_URL') ?? ZPAN_CLOUD_URL_DEFAULT
}

async function getInstanceOrigin(c: {
  get(key: 'deps'): Env['Variables']['deps']
  req: { url: string; header(name: string): string | undefined }
}): Promise<string> {
  const configured = await getSitePublicOrigin(c.get('deps'))
  if (configured) return configured
  return originFromRequestUrl(c.req.url) ?? new URL(c.req.url).origin
}

async function getRequestHost(c: {
  get(key: 'deps'): Env['Variables']['deps']
  req: { url: string; header(name: string): string | undefined }
}): Promise<string> {
  const configured = await getSitePublicOrigin(c.get('deps'))
  if (configured) return new URL(configured).host
  const forwardedHost = c.req.header('x-forwarded-host') ?? c.req.header('host')
  return normalizeHost(forwardedHost) ?? new URL(c.req.url).host
}

// Best-effort release of a cloud binding ZPan couldn't accept. Returns the failure
// message (surfaced for diagnostics) or null. Leaving the cloud binding orphaned is
// the safe direction — ZPan stays unbound either way — so a failure here does not
// change the user-facing outcome.
async function rollbackCloudBinding(
  licensingCloud: Env['Variables']['deps']['licensingCloud'],
  baseUrl: string,
  result: PairingPollResponse,
): Promise<string | null> {
  if (!result.refreshToken || !result.binding?.id) return null
  try {
    await licensingCloud.unbindCloudLicense(baseUrl, result.binding.id, result.refreshToken)
    return null
  } catch (error) {
    return error instanceof Error ? error.message : 'Cloud unbind failed'
  }
}

const app = new Hono<Env>()
  .use(requireAdmin)

  .post('/pair', async (c) => {
    const db = c.get('platform').db
    const baseUrl = getCloudBaseUrl(c)

    const instance = await buildCloudInstanceInfo(db, {
      url: await getInstanceOrigin(c),
      runtime: runtimeInfo(c.get('platform')),
    })

    const pairing = await c.get('deps').licensingCloud.createPairing(baseUrl, instance)
    return c.json(pairing)
  })

  .get('/pair/:code/poll', async (c) => {
    const { code } = c.req.param()
    const baseUrl = getCloudBaseUrl(c)

    const result = await c.get('deps').licensingCloud.pollPairing(baseUrl, code)

    if (result.status === 'approved') {
      const instanceId = await c.get('deps').instance.getOrCreateInstanceId()
      const verification = result.certificate
        ? verifyCertificateResult(result.certificate, {
            instanceId,
            currentHost: await getRequestHost(c),
            cloudBaseUrl: baseUrl,
          })
        : null

      if (!verification?.ok || !result.refreshToken || !result.binding?.storeId || !result.account) {
        // The cloud approved and created a binding, but ZPan can't accept this
        // certificate (most often: signed by a key ZPan doesn't trust). Roll back
        // the orphaned cloud binding so the two sides don't drift and retries don't
        // pile up dangling bindings.
        const cloudUnbindError = await rollbackCloudBinding(c.get('deps').licensingCloud, baseUrl, result)
        const reason = verification ? (verification.ok ? 'incomplete_response' : verification.reason) : 'no_certificate'
        return c.json({ error: 'invalid_certificate', reason, cloud_unbind_error: cloudUnbindError }, 502)
      }

      const assertion = verification.assertion
      await c.get('deps').licenseBinding.createLicenseBinding({
        cloudBindingId: result.binding.id,
        cloudStoreId: result.binding.storeId,
        instanceId,
        cloudAccountId: result.account.id,
        cloudAccountEmail: result.account.email,
        refreshToken: result.refreshToken,
        cachedCert: result.certificate!,
        cachedExpiresAt: assertion.expiresAt,
        lastRefreshAt: Math.floor(Date.now() / 1000),
      })

      invalidateEntitlementCache()

      // Report back that we verified + stored the certificate, so the cloud pairing
      // page resolves to success instead of claiming it at approval time. Best-effort:
      // the binding is already active locally, so a failed confirm only leaves the
      // cloud page waiting — it does not break licensing here.
      try {
        await c.get('deps').licensingCloud.confirmCloudLicense(baseUrl, result.binding.id, result.refreshToken)
      } catch {
        // ignore — binding works regardless; cloud page falls back to its timeout state
      }

      const userId = c.get('userId')!
      const orgId = c.get('orgId')!
      await c.get('deps').activity.record({
        orgId,
        userId,
        action: 'license_pair',
        targetType: 'license',
        targetName: result.account.email ?? result.account.id,
        metadata: { edition: assertion.edition, cloudAccountId: result.account.id },
      })

      return c.json({
        status: 'approved' as const,
        edition: assertion.edition,
        cloud_store_id: result.binding.storeId,
      })
    }

    return c.json({ status: result.status })
  })

  .post('/refresh', async (c) => {
    const db = c.get('platform').db
    const userId = c.get('userId')!
    const orgId = c.get('orgId')!
    const baseUrl = getCloudBaseUrl(c)
    const instance = await buildCloudInstanceInfo(db, {
      url: await getInstanceOrigin(c),
      runtime: runtimeInfo(c.get('platform')),
    })

    await performRefresh(db, baseUrl, instance)

    const state = await c.get('deps').licenseBinding.loadLicenseState()

    await c.get('deps').activity.record({
      orgId,
      userId,
      action: 'license_refresh',
      targetType: 'license',
      targetName: 'license binding',
    })

    return c.json({ success: true, last_refresh_at: state.lastRefreshAt })
  })

  .delete('/binding', async (c) => {
    const userId = c.get('userId')!
    const orgId = c.get('orgId')!
    const baseUrl = getCloudBaseUrl(c)
    const state = await c.get('deps').licenseBinding.loadLicenseState()
    let cloudUnbindError: string | null = null

    if (state.refreshToken) {
      try {
        await c.get('deps').licensingCloud.unbindCloudLicense(baseUrl, state.cloudBindingId, state.refreshToken)
      } catch (error) {
        cloudUnbindError = error instanceof Error ? error.message : 'Cloud unbind failed'
      }
    }

    await c.get('deps').licenseBinding.clearLicenseBinding()
    invalidateEntitlementCache()

    await c.get('deps').activity.record({
      orgId,
      userId,
      action: 'license_disconnect',
      targetType: 'license',
      targetName: 'license binding',
      metadata: cloudUnbindError ? { cloudUnbindError } : undefined,
    })

    return c.json({ deleted: true, cloud_unbind_error: cloudUnbindError })
  })

export default app
