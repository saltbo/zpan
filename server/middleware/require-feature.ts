import type { ProFeature } from '@shared/types'
import type { Context } from 'hono'
import { createMiddleware } from 'hono/factory'
import { ZPAN_CLOUD_URL_DEFAULT } from '../../shared/constants'
import { hasFeature } from '../domain/licensing'
import { normalizeHost } from '../licensing/verify'
import { loadBindingState } from '../usecases/licensing'
import { getSitePublicOrigin } from '../usecases/site-public-origin'
import type { Env } from './platform'

async function configuredPublicHost(c: Context<Env>): Promise<string | null> {
  const origin = await getSitePublicOrigin(c.get('deps'))
  return origin ? new URL(origin).host : null
}

export function requireFeature(name: ProFeature) {
  return createMiddleware<Env>(async (c, next) => {
    const cloudBaseUrl = c.get('platform').getEnv('ZPAN_CLOUD_URL') ?? ZPAN_CLOUD_URL_DEFAULT
    const currentHost =
      (await configuredPublicHost(c)) ?? normalizeHost(c.req.header('host')) ?? new URL(c.req.url).host
    const state = await loadBindingState(c.get('deps'), { currentHost, cloudBaseUrl })
    if (!hasFeature(name, state)) {
      return c.json({ error: 'feature_not_available', feature: name, upgrade_url: '/settings/billing' }, 402)
    }
    await next()
  })
}
