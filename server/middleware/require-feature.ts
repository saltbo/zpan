import type { ProFeature } from '@shared/types'
import { createMiddleware } from 'hono/factory'
import { ZPAN_CLOUD_URL_DEFAULT } from '../../shared/constants'
import { hasFeature, loadBindingState } from '../licensing/has-feature'
import { normalizeHost } from '../licensing/verify'
import type { Env } from './platform'

export function requireFeature(name: ProFeature) {
  return createMiddleware<Env>(async (c, next) => {
    const db = c.get('platform').db
    const cloudBaseUrl = c.get('platform').getEnv('ZPAN_CLOUD_URL') ?? ZPAN_CLOUD_URL_DEFAULT
    const currentHost =
      normalizeHost(c.req.header('x-forwarded-host') ?? c.req.header('host')) ?? new URL(c.req.url).host
    const state = await loadBindingState(db, { currentHost, cloudBaseUrl })
    if (!hasFeature(name, state)) {
      return c.json({ error: 'feature_not_available', feature: name, upgrade_url: '/settings/billing' }, 402)
    }
    await next()
  })
}
