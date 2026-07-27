import { createRoute, OpenAPIHono, z } from '@hono/zod-openapi'
import { createTestEmailSchema, emailSettingsSchema, updateEmailSettingsSchema } from '@shared/schemas'
import { requireAdmin } from '../../middleware/auth'
import type { Env } from '../../middleware/platform'
import { getEmailConfig, saveEmailConfig, sendTestEmail } from '../../usecases/site/email-config'
import { errorResponse, jsonContent } from '../openapi'

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
  request: { body: { content: { 'application/json': { schema: updateEmailSettingsSchema } }, required: true } },
  responses: {
    200: jsonContent(successSchema, 'Saved'),
    400: errorResponse('Invalid email configuration'),
  },
})

const testRoute = createRoute({
  operationId: 'sendTestEmail',
  summary: 'Send a test email',
  tags: ['Email Config'],
  method: 'post',
  path: '/test-messages',
  middleware: [requireAdmin] as const,
  request: { body: { content: { 'application/json': { schema: createTestEmailSchema } }, required: true } },
  responses: {
    200: jsonContent(successSchema, 'Sent'),
    400: errorResponse('Send failed'),
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
    if (!result.ok) throw result.error
    return c.json({ success: true }, 200)
  })

export default emailConfig
