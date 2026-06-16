import { createRoute, OpenAPIHono, z } from '@hono/zod-openapi'
import { requireAdmin } from '../../middleware/auth'
import type { Env } from '../../middleware/platform'
import { getEmailConfig, saveEmailConfig, sendTestEmail } from '../../usecases/site/email-config'
import { jsonContent } from '../openapi'

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
  http: z.object({ url: z.string().url(), apiKey: z.string().min(1) }),
})

const cloudflareConfigSchema = z.object({
  enabled: z.boolean(),
  provider: z.literal('cloudflare'),
  from: z.string().email(),
})

const emailConfigSchema = z.discriminatedUnion('provider', [smtpConfigSchema, httpConfigSchema, cloudflareConfigSchema])

// The masked read shape is provider-polymorphic (secrets redacted). Documented
// with the stable fields; provider-specific masked settings vary and are not
// modeled field-for-field (no `additionalProperties` — oapi-codegen mishandles it).
const emailSettingsSchema = z
  .object({ enabled: z.boolean(), provider: z.string().nullable().optional(), from: z.string().optional() })
  .openapi('EmailSettings')

const testEmailSchema = z.object({ to: z.string().email() })

const successSchema = z.object({ success: z.boolean() })

const getRoute = createRoute({
  operationId: 'getEmailConfig',
  summary: 'Get email configuration',
  tags: ['Email Config'],
  method: 'get',
  path: '/',
  middleware: [requireAdmin] as const,
  responses: { 200: jsonContent(emailSettingsSchema, 'Email settings') },
})

const saveRoute = createRoute({
  operationId: 'saveEmailConfig',
  summary: 'Save email configuration',
  tags: ['Email Config'],
  method: 'put',
  path: '/',
  middleware: [requireAdmin] as const,
  request: { body: { content: { 'application/json': { schema: emailConfigSchema } }, required: true } },
  responses: { 200: jsonContent(successSchema, 'Saved') },
})

const testRoute = createRoute({
  operationId: 'sendTestEmail',
  summary: 'Send a test email',
  tags: ['Email Config'],
  method: 'post',
  path: '/test-messages',
  middleware: [requireAdmin] as const,
  request: { body: { content: { 'application/json': { schema: testEmailSchema } }, required: true } },
  responses: {
    200: jsonContent(successSchema, 'Sent'),
    400: jsonContent(z.object({ success: z.boolean(), error: z.string() }), 'Send failed'),
  },
})

const app = new OpenAPIHono<Env>()

const emailConfig = app
  .openapi(getRoute, async (c) => c.json(await getEmailConfig(c.get('deps'), c.get('platform')), 200))
  .openapi(saveRoute, async (c) => {
    await saveEmailConfig(c.get('deps'), c.req.valid('json'))
    return c.json({ success: true }, 200)
  })
  .openapi(testRoute, async (c) => {
    const result = await sendTestEmail(c.get('deps'), c.get('platform'), c.req.valid('json').to)
    if (result.ok) return c.json({ success: true }, 200)
    return c.json({ success: false, error: result.message }, 400)
  })

export default emailConfig
