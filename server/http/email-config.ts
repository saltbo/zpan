import { zValidator } from '@hono/zod-validator'
import { Hono } from 'hono'
import { z } from 'zod'
import { requireAdmin } from '../middleware/auth'
import type { Env } from '../middleware/platform'
import { getEmailConfig, saveEmailConfig, sendTestEmail } from '../usecases/email-config'

const smtpConfigSchema = z.object({
  enabled: z.boolean(),
  provider: z.literal('smtp'),
  from: z.string().email(),
  smtp: z.object({
    host: z.string().min(1),
    port: z.number().int().min(1).max(65535),
    user: z.string(),
    pass: z.string(),
    secure: z.boolean(),
  }),
})

const httpConfigSchema = z.object({
  enabled: z.boolean(),
  provider: z.literal('http'),
  from: z.string().email(),
  http: z.object({
    url: z.string().url(),
    apiKey: z.string().min(1),
  }),
})

const cloudflareConfigSchema = z.object({
  enabled: z.boolean(),
  provider: z.literal('cloudflare'),
  from: z.string().email(),
})

const emailConfigSchema = z.discriminatedUnion('provider', [smtpConfigSchema, httpConfigSchema, cloudflareConfigSchema])

const testEmailSchema = z.object({
  to: z.string().email(),
})

const app = new Hono<Env>()
  .use(requireAdmin)
  .get('/', async (c) => c.json(await getEmailConfig(c.get('deps'), c.get('platform'))))
  .put('/', zValidator('json', emailConfigSchema), async (c) => {
    await saveEmailConfig(c.get('deps'), c.req.valid('json'))
    return c.json({ success: true })
  })
  .post('/test-messages', zValidator('json', testEmailSchema), async (c) => {
    const result = await sendTestEmail(c.get('deps'), c.get('platform'), c.req.valid('json').to)
    if (result.ok) return c.json({ success: true })
    return c.json({ success: false, error: result.message }, 400)
  })

export default app
