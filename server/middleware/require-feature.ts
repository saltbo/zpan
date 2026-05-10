import type { ProFeature } from '@shared/types'
import type { Context } from 'hono'
import { createMiddleware } from 'hono/factory'
import { ZPAN_CLOUD_URL_DEFAULT } from '../../shared/constants'
import { hasFeature, loadBindingState } from '../licensing/has-feature'
import { normalizeHost } from '../licensing/verify'
import type { Env } from './platform'

function configuredPublicHost(c: Context<Env>): string | null {
  const value = c.get('platform').getEnv('ZPAN_PUBLIC_ORIGIN') ?? c.get('platform').getEnv('BETTER_AUTH_URL')
  if (!value) return null
  try {
    const url = new URL(value)
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return null
    return url.host
  } catch {
    return null
  }
}

export function requireFeature(name: ProFeature) {
  return createMiddleware<Env>(async (c, next) => {
    const db = c.get('platform').db
    const cloudBaseUrl = c.get('platform').getEnv('ZPAN_CLOUD_URL') ?? ZPAN_CLOUD_URL_DEFAULT
    const currentHost = configuredPublicHost(c) ?? normalizeHost(c.req.header('host')) ?? new URL(c.req.url).host
    const state = await loadBindingState(db, { currentHost, cloudBaseUrl })
    if (!hasFeature(name, state)) {
      return c.json({ error: 'feature_not_available', feature: name, upgrade_url: '/settings/billing' }, 402)
    }
    await next()
  })
}
