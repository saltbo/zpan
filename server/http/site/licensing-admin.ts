import { Hono } from 'hono'
import { ZPAN_CLOUD_URL_DEFAULT } from '../../../shared/constants'
import { originFromRequestUrl } from '../../domain/site-public-origin'
import { requireAdmin } from '../../middleware/auth'
import type { Env } from '../../middleware/platform'
import { runtimeInfo } from '../../usecases/site/instance-info'
import {
  initiatePairing,
  normalizeHost,
  pollPairing,
  triggerRefresh,
  unbindLicense,
} from '../../usecases/site/licensing'
import { getSitePublicOrigin } from '../../usecases/site/site-public-origin'

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

const app = new Hono<Env>()
  .use(requireAdmin)

  .post('/pairings', async (c) => {
    const pairing = await initiatePairing(c.get('deps'), {
      baseUrl: getCloudBaseUrl(c),
      instanceUrl: await getInstanceOrigin(c),
      runtime: runtimeInfo(c.get('platform')),
    })
    return c.json(pairing)
  })

  .get('/pairings/:code', async (c) => {
    const result = await pollPairing(c.get('deps'), {
      baseUrl: getCloudBaseUrl(c),
      code: c.req.param('code'),
      currentHost: await getRequestHost(c),
      userId: c.get('userId')!,
      orgId: c.get('orgId')!,
    })

    if (!result.ok) {
      return c.json(
        { error: 'invalid_certificate', reason: result.reason, cloud_unbind_error: result.cloudUnbindError },
        502,
      )
    }

    if (result.status === 'approved') {
      return c.json({ status: 'approved' as const, edition: result.edition, cloud_store_id: result.cloudStoreId })
    }

    return c.json({ status: result.status })
  })

  .post('/refresh-runs', async (c) => {
    const { lastRefreshAt } = await triggerRefresh(c.get('deps'), {
      baseUrl: getCloudBaseUrl(c),
      instanceUrl: await getInstanceOrigin(c),
      runtime: runtimeInfo(c.get('platform')),
      userId: c.get('userId')!,
      orgId: c.get('orgId')!,
    })
    return c.json({ success: true, last_refresh_at: lastRefreshAt })
  })

  .delete('/binding', async (c) => {
    const { cloudUnbindError } = await unbindLicense(c.get('deps'), {
      baseUrl: getCloudBaseUrl(c),
      userId: c.get('userId')!,
      orgId: c.get('orgId')!,
    })
    return c.json({ deleted: true, cloud_unbind_error: cloudUnbindError })
  })

export default app
