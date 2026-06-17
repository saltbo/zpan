import { createRoute, OpenAPIHono, z } from '@hono/zod-openapi'
import { pageQuerySchema, pageSchema } from '@shared/schemas'
import { requireAdmin } from '../../middleware/auth'
import type { Env } from '../../middleware/platform'
import type { InviteCodeRecord } from '../../usecases/ports'
import {
  deleteInviteCode,
  generateInviteCodes,
  listInviteCodes,
  validateInviteCode,
} from '../../usecases/site/invite-code'
import { apiError, errorResponse, jsonBody, jsonContent } from '../openapi'

const inviteCodeSchema = z
  .object({
    id: z.string(),
    code: z.string(),
    createdBy: z.string(),
    usedBy: z.string().nullable(),
    usedAt: z.string().nullable(),
    expiresAt: z.string().nullable(),
    createdAt: z.string(),
  })
  .openapi('InviteCode')

type InviteCodeDTO = z.infer<typeof inviteCodeSchema>

function toInviteCodeDTO(r: InviteCodeRecord): InviteCodeDTO {
  return {
    ...r,
    usedAt: r.usedAt ? r.usedAt.toISOString() : null,
    expiresAt: r.expiresAt ? r.expiresAt.toISOString() : null,
    createdAt: r.createdAt.toISOString(),
  }
}

const inviteCodeListSchema = pageSchema(inviteCodeSchema, 'InviteCodeList')

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

const listRoute = createRoute({
  operationId: 'listInviteCodes',
  summary: 'List invite codes',
  tags: ['Invite Codes'],
  method: 'get',
  path: '/',
  middleware: [requireAdmin] as const,
  request: { query: pageQuerySchema },
  responses: { 200: jsonContent(inviteCodeListSchema, 'Invite codes') },
})

const generateRoute = createRoute({
  operationId: 'generateInviteCodes',
  summary: 'Generate invite codes',
  tags: ['Invite Codes'],
  method: 'post',
  path: '/',
  middleware: [requireAdmin] as const,
  request: jsonBody(generateSchema),
  responses: {
    201: jsonContent(z.object({ codes: z.array(inviteCodeSchema) }), 'Generated invite codes'),
    401: errorResponse('Unauthorized'),
  },
})

const deleteRoute = createRoute({
  operationId: 'deleteInviteCode',
  summary: 'Delete invite code',
  tags: ['Invite Codes'],
  method: 'delete',
  path: '/{id}',
  middleware: [requireAdmin] as const,
  request: { params: z.object({ id: z.string() }) },
  responses: {
    200: jsonContent(z.object({ id: z.string(), deleted: z.literal(true) }), 'Deleted invite code'),
    400: errorResponse('Cannot delete a used invite code'),
    404: errorResponse('Invite code not found'),
  },
})

const validateRoute = createRoute({
  operationId: 'validateInviteCode',
  summary: 'Validate an invite code',
  tags: ['Invite Codes'],
  method: 'post',
  path: '/validations',
  request: jsonBody(validateSchema),
  responses: {
    200: jsonContent(z.object({ valid: z.boolean(), error: z.string().optional() }), 'Validation result'),
  },
})

export const adminInviteCodes = new OpenAPIHono<Env>()
  .openapi(listRoute, async (c) => {
    const { page, pageSize } = c.req.valid('query')
    const result = await listInviteCodes(c.get('deps'), { page, pageSize })
    return c.json({ items: result.items.map(toInviteCodeDTO), total: result.total, page, pageSize }, 200)
  })
  .openapi(generateRoute, async (c) => {
    const userId = c.get('userId')
    if (!userId) return apiError(c, 401, 'Unauthorized')
    const { count, expiresInDays } = c.req.valid('json')
    const result = await generateInviteCodes(c.get('deps'), { userId, orgId: c.get('orgId')!, count, expiresInDays })
    return c.json({ codes: result.codes.map(toInviteCodeDTO) }, 201)
  })
  .openapi(deleteRoute, async (c) => {
    const id = c.req.valid('param').id
    const result = await deleteInviteCode(c.get('deps'), { userId: c.get('userId')!, orgId: c.get('orgId')!, id })
    if (result.ok) return c.json({ id, deleted: true as const }, 200)
    if (result.reason === 'not_found') return apiError(c, 404, 'Invite code not found')
    return apiError(c, 400, 'Cannot delete a used invite code')
  })

export const publicInviteCodes = new OpenAPIHono<Env>().openapi(validateRoute, async (c) => {
  const { code } = c.req.valid('json')
  return c.json(await validateInviteCode(c.get('deps'), code), 200)
})
