import { zValidator } from '@hono/zod-validator'
import { eq, like } from 'drizzle-orm'
import { Hono } from 'hono'
import { z } from 'zod'
import {
  BUILTIN_PROVIDER_IDS,
  isValidProviderId,
  OAUTH_PROVIDER_KEY_PATTERN,
  OAUTH_PROVIDER_KEY_PREFIX,
  OAuthProviderMeta,
  parseProviderConfig,
} from '../../shared/oauth-providers'
import { systemOptions } from '../db/schema'
import { requireAdmin } from '../middleware/auth'
import type { Env } from '../middleware/platform'

function optionKey(providerId: string): string {
  return `${OAUTH_PROVIDER_KEY_PREFIX}${providerId}`
}

function maskSecret(secret: string): string {
  if (secret.length <= 4) return '****'
  return `${'*'.repeat(secret.length - 4)}${secret.slice(-4)}`
}

const upsertSchema = z.object({
  type: z.enum(['builtin', 'oidc']),
  clientId: z.string().min(1),
  clientSecret: z.string().min(1),
  enabled: z.boolean(),
  discoveryUrl: z.string().url().optional(),
  scopes: z.array(z.string()).optional(),
})

// Public: enabled providers only, no secrets (for login page buttons)
export const publicAuthProviders = new Hono<Env>().get('/', async (c) => {
  const db = c.get('platform').db
  const rows = await db.select().from(systemOptions).where(like(systemOptions.key, OAUTH_PROVIDER_KEY_PATTERN))
  const items = rows
    .map((r) => {
      const config = parseProviderConfig(r.value)
      if (!config?.enabled) return null
      const meta = OAuthProviderMeta[config.providerId]
      return {
        providerId: config.providerId,
        type: config.type,
        name: meta?.name ?? config.providerId,
        icon: meta?.icon ?? config.providerId,
      }
    })
    .filter((item) => item !== null)
  return c.json({ items })
})

// Admin: full CRUD with secrets masked
export const adminAuthProviders = new Hono<Env>()
  .use(requireAdmin)
  .get('/', async (c) => {
    const db = c.get('platform').db
    const rows = await db.select().from(systemOptions).where(like(systemOptions.key, OAUTH_PROVIDER_KEY_PATTERN))
    const items = rows
      .map((r) => {
        const config = parseProviderConfig(r.value)
        if (!config) return null
        return { ...config, clientSecret: maskSecret(config.clientSecret) }
      })
      .filter((item) => item !== null)
    return c.json({ items })
  })
  .put('/:providerId', zValidator('json', upsertSchema), async (c) => {
    const db = c.get('platform').db
    const providerId = c.req.param('providerId')
    const body = c.req.valid('json')

    if (!isValidProviderId(providerId)) {
      return c.json({ error: 'Provider ID must contain only lowercase letters, numbers, and hyphens' }, 400)
    }
    if (body.type === 'builtin' && !BUILTIN_PROVIDER_IDS.includes(providerId)) {
      return c.json({ error: `Unknown builtin provider: ${providerId}` }, 400)
    }
    if (body.type === 'oidc' && !body.discoveryUrl) {
      return c.json({ error: 'discoveryUrl is required for OIDC providers' }, 400)
    }

    const config = { providerId, ...body }
    const key = optionKey(providerId)
    const value = JSON.stringify(config)

    const existing = await db.select({ key: systemOptions.key }).from(systemOptions).where(eq(systemOptions.key, key))
    if (existing.length > 0) {
      await db.update(systemOptions).set({ value, public: false }).where(eq(systemOptions.key, key))
    } else {
      await db.insert(systemOptions).values({ key, value, public: false })
    }

    return c.json({ ...config, clientSecret: maskSecret(config.clientSecret) })
  })
  .delete('/:providerId', async (c) => {
    const db = c.get('platform').db
    const providerId = c.req.param('providerId')
    if (!isValidProviderId(providerId)) {
      return c.json({ error: 'Provider ID must contain only lowercase letters, numbers, and hyphens' }, 400)
    }
    await db.delete(systemOptions).where(eq(systemOptions.key, optionKey(providerId)))
    return c.json({ providerId, deleted: true })
  })
