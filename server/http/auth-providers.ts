import { zValidator } from '@hono/zod-validator'
import { Hono } from 'hono'
import { z } from 'zod'
import { requireAdmin } from '../middleware/auth'
import type { Env } from '../middleware/platform'
import {
  deleteAuthProvider,
  listAuthProviders,
  listPublicAuthProviders,
  type SocialLoginFeatureBlock,
  upsertAuthProvider,
} from '../usecases/auth-provider'

const invalidProviderId = { error: 'Provider ID must contain only lowercase letters, numbers, and hyphens' } as const

const featureNotAvailable = (block: SocialLoginFeatureBlock) =>
  ({ error: 'feature_not_available', ...block, upgrade_url: '/settings/billing' }) as const

const upsertSchema = z.object({
  type: z.enum(['builtin', 'oidc']),
  clientId: z.string().min(1),
  clientSecret: z.string().min(1),
  enabled: z.boolean(),
  discoveryUrl: z.string().url().optional(),
  scopes: z.array(z.string()).optional(),
})

// Public: enabled providers only, no secrets (for login page buttons)
export const publicAuthProviders = new Hono<Env>().get('/', async (c) =>
  c.json(await listPublicAuthProviders(c.get('deps'))),
)

// Admin: full CRUD with secrets masked
export const adminAuthProviders = new Hono<Env>()
  .use(requireAdmin)
  .get('/', async (c) => c.json(await listAuthProviders(c.get('deps'))))
  .put('/:providerId', zValidator('json', upsertSchema), async (c) => {
    const result = await upsertAuthProvider(c.get('deps'), c.req.param('providerId'), c.req.valid('json'))
    if (result.ok) return c.json(result.config)
    if (result.reason === 'invalid_id') return c.json(invalidProviderId, 400)
    if (result.reason === 'unknown_builtin') {
      return c.json({ error: `Unknown builtin provider: ${c.req.param('providerId')}` }, 400)
    }
    if (result.reason === 'missing_discovery')
      return c.json({ error: 'discoveryUrl is required for OIDC providers' }, 400)
    return c.json(featureNotAvailable(result.block), 402)
  })
  .delete('/:providerId', async (c) => {
    const providerId = c.req.param('providerId')
    const result = await deleteAuthProvider(c.get('deps'), providerId)
    if (!result.ok) return c.json(invalidProviderId, 400)
    return c.json({ providerId, deleted: true })
  })
