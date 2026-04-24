import type { ProFeature } from '@shared/types'
import { createMiddleware } from 'hono/factory'
import { hasFeature, loadBindingState } from '../licensing/has-feature'
import type { Env } from './platform'

export function requireFeature(name: ProFeature) {
  return createMiddleware<Env>(async (c, next) => {
    const db = c.get('platform').db
    const state = await loadBindingState(db)
    if (!hasFeature(name, state)) {
      return c.json(
        { error: 'feature_not_available', feature: name, upgrade_url: '/settings/billing' },
        402,
      )
    }
    await next()
  })
}
