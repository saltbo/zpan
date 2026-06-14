import { zValidator } from '@hono/zod-validator'
import { Hono } from 'hono'
import { z } from 'zod'
import { requireAdmin } from '../middleware/auth'
import type { Env } from '../middleware/platform'
import { deleteInviteCode, generateInviteCodes, listInviteCodes, validateInviteCode } from '../usecases/invite-code'

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
    return c.json(await listInviteCodes(c.get('deps'), { page, pageSize }))
  })
  .post('/', zValidator('json', generateSchema), async (c) => {
    const userId = c.get('userId')
    if (!userId) return c.json({ error: 'Unauthorized' }, 401)
    const { count, expiresInDays } = c.req.valid('json')
    const result = await generateInviteCodes(c.get('deps'), {
      userId,
      orgId: c.get('orgId')!,
      count,
      expiresInDays,
    })
    return c.json(result, 201)
  })
  .delete('/:id', async (c) => {
    const id = c.req.param('id')
    const result = await deleteInviteCode(c.get('deps'), {
      userId: c.get('userId')!,
      orgId: c.get('orgId')!,
      id,
    })
    if (result.ok) return c.json({ id, deleted: true })
    if (result.reason === 'not_found') return c.json({ error: 'Invite code not found' }, 404)
    return c.json({ error: 'Cannot delete a used invite code' }, 400)
  })

export const publicInviteCodes = new Hono<Env>().post('/validations', zValidator('json', validateSchema), async (c) => {
  const { code } = c.req.valid('json')
  return c.json(await validateInviteCode(c.get('deps'), code))
})
