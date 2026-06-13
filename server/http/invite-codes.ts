import { zValidator } from '@hono/zod-validator'
import { Hono } from 'hono'
import { z } from 'zod'
import { requireAdmin } from '../middleware/auth'
import type { Env } from '../middleware/platform'

const generateSchema = z.object({
  count: z.number().int().min(1).max(100),
  expiresInDays: z.number().int().min(1).optional(),
})

const validateSchema = z.object({
  code: z
    .string()
    .length(8)
    .regex(/^[0-9A-Z]{8}$/),
})

const paginationSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
})

export const adminInviteCodes = new Hono<Env>()
  .use(requireAdmin)
  .get('/', zValidator('query', paginationSchema), async (c) => {
    const { page, pageSize } = c.req.valid('query')
    const result = await c.get('deps').invites.list(page, pageSize)
    return c.json(result)
  })
  .post('/', zValidator('json', generateSchema), async (c) => {
    const userId = c.get('userId')
    if (!userId) return c.json({ error: 'Unauthorized' }, 401)
    const orgId = c.get('orgId')!
    const { count, expiresInDays } = c.req.valid('json')
    const expiresAt = expiresInDays ? new Date(Date.now() + expiresInDays * 86400000) : undefined
    const codes = await c.get('deps').invites.generate(userId, count, expiresAt)
    await c.get('deps').activity.record({
      orgId,
      userId,
      action: 'invite_code_generate',
      targetType: 'invite_code',
      targetName: `${codes.length} codes`,
      metadata: { count: codes.length, expiresInDays },
    })
    return c.json({ codes }, 201)
  })
  .delete('/:id', async (c) => {
    const userId = c.get('userId')!
    const orgId = c.get('orgId')!
    const id = c.req.param('id')
    const result = await c.get('deps').invites.delete(id)
    if (result === 'not_found') return c.json({ error: 'Invite code not found' }, 404)
    if (result === 'already_used') return c.json({ error: 'Cannot delete a used invite code' }, 400)
    await c.get('deps').activity.record({
      orgId,
      userId,
      action: 'invite_code_delete',
      targetType: 'invite_code',
      targetId: id,
      targetName: id,
    })
    return c.json({ id, deleted: true })
  })

export const publicInviteCodes = new Hono<Env>().post('/validations', zValidator('json', validateSchema), async (c) => {
  const { code } = c.req.valid('json')
  const result = await c.get('deps').invites.validate(code)
  return c.json(result)
})
