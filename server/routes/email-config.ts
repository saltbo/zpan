import { zValidator } from '@hono/zod-validator'
import { Hono } from 'hono'
import { z } from 'zod'
import { systemOptions } from '../db/schema'
import { requireAdmin } from '../middleware/auth'
import type { Env } from '../middleware/platform'
import type { Database } from '../platform/interface'
import { type EmailConfig, getEmailConfig, sendEmail } from '../services/email'

const smtpConfigSchema = z.object({
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
  provider: z.literal('http'),
  from: z.string().email(),
  http: z.object({
    url: z.string().url(),
    apiKey: z.string().min(1),
  }),
})

const emailConfigSchema = z.discriminatedUnion('provider', [smtpConfigSchema, httpConfigSchema])

const testEmailSchema = z.object({
  to: z.string().email(),
})

function maskSecret(value: string): string {
  if (value.length === 0) return ''
  return `****${value.slice(-4)}`
}

function maskConfig(config: EmailConfig): Record<string, unknown> {
  if (config.provider === 'smtp') {
    return {
      provider: config.provider,
      from: config.from,
      smtp: {
        host: config.smtp.host,
        port: config.smtp.port,
        user: config.smtp.user,
        pass: maskSecret(config.smtp.pass),
        secure: config.smtp.secure,
      },
    }
  }
  return {
    provider: config.provider,
    from: config.from,
    http: {
      url: config.http.url,
      apiKey: maskSecret(config.http.apiKey),
    },
  }
}

async function saveOptions(db: Database, entries: [string, string][]) {
  const rows = entries.map(([key, value]) => ({ key, value, public: false }))
  for (const row of rows) {
    await db
      .insert(systemOptions)
      .values(row)
      .onConflictDoUpdate({ target: systemOptions.key, set: { value: row.value, public: false } })
  }
}

const app = new Hono<Env>()
  .use(requireAdmin)
  .get('/', async (c) => {
    const db = c.get('platform').db
    try {
      const config = await getEmailConfig(db)
      return c.json(maskConfig(config))
    } catch (e) {
      if (e instanceof Error && e.message.includes('not configured')) {
        return c.json({ provider: null })
      }
      throw e
    }
  })
  .put('/', zValidator('json', emailConfigSchema), async (c) => {
    const db = c.get('platform').db
    const body = c.req.valid('json')

    const entries: [string, string][] = [
      ['email_provider', body.provider],
      ['email_from', body.from],
    ]

    if (body.provider === 'smtp') {
      entries.push(
        ['email_smtp_host', body.smtp.host],
        ['email_smtp_port', String(body.smtp.port)],
        ['email_smtp_user', body.smtp.user],
        ['email_smtp_pass', body.smtp.pass],
        ['email_smtp_secure', String(body.smtp.secure)],
      )
    } else {
      entries.push(['email_http_url', body.http.url], ['email_http_api_key', body.http.apiKey])
    }

    await saveOptions(db, entries)
    return c.json({ success: true })
  })
  .post('/test', zValidator('json', testEmailSchema), async (c) => {
    const db = c.get('platform').db
    const { to } = c.req.valid('json')
    try {
      await sendEmail(db, {
        to,
        subject: 'ZPan Test Email',
        html: '<h1>Test Email</h1><p>Your email configuration is working correctly.</p>',
      })
      return c.json({ success: true })
    } catch (e) {
      const message = e instanceof Error ? e.message : 'Unknown error'
      return c.json({ success: false, error: message }, 400)
    }
  })

export default app
