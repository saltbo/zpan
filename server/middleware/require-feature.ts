import type { ProFeature } from '@shared/types'
import { createMiddleware } from 'hono/factory'
import { ZPAN_CLOUD_URL_DEFAULT } from '../../shared/constants'
import { hasFeature } from '../domain/licensing'
import { featureBlocked } from '../usecases/ports'
import { loadBindingState } from '../usecases/site/licensing'
import { licenseRequestHost } from './license-host'
import type { Env } from './platform'

export function requireFeature(name: ProFeature) {
  return createMiddleware<Env>(async (c, next) => {
    const cloudBaseUrl = c.get('platform').getEnv('ZPAN_CLOUD_URL') ?? ZPAN_CLOUD_URL_DEFAULT
    const currentHost = await licenseRequestHost(c)
    const state = await loadBindingState(c.get('deps'), { currentHost, cloudBaseUrl })
    if (!hasFeature(name, state)) {
      throw featureBlocked('Feature not available', {
        metadata: { feature: name, upgradeUrl: '/settings/billing' },
      })
    }
    await next()
  })
}
