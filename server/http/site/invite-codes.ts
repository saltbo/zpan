import { OpenAPIHono, z } from '@hono/zod-openapi'
import { AuthorizationScope } from '@shared/authorization'
import { pageQuerySchema, pageSchema } from '@shared/schemas'
import { opaqueIdSchema, opaqueTokenSchema } from '@shared/schemas/identifiers'
import type { Env } from '../../middleware/platform'
import { type InviteCodeRecord, unauthorized } from '../../usecases/ports'
import {
  deleteInviteCode,
  generateInviteCodes,
  listInviteCodes,
  validateInviteCode,
} from '../../usecases/site/invite-code'
import { authRoute, errorResponse, jsonBody, jsonContent } from '../openapi'

const inviteCodeSchema = z
  .object({
    id: opaqueIdSchema,
    code: opaqueTokenSchema,
    createdBy: opaqueIdSchema,
    usedBy: opaqueIdSchema.nullable(),
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
    .regex(/^[A-Za-z0-9]{8}$/),
})

const listRoute = authRoute(
  { scopes: [AuthorizationScope.INVITE_CODES_READ], siteRole: 'admin' },
  {
    operationId: 'listInviteCodes',
    summary: 'List invite codes',
    tags: ['Invite Codes'],
    method: 'get',
    path: '/',
    request: { query: pageQuerySchema },
    responses: { 200: jsonContent(inviteCodeListSchema, 'Invite codes') },
  },
)

const generateRoute = authRoute(
  { scopes: [AuthorizationScope.INVITE_CODES_CREATE], siteRole: 'admin' },
  {
    operationId: 'generateInviteCodes',
    summary: 'Generate invite codes',
    tags: ['Invite Codes'],
    method: 'post',
    path: '/',
    request: jsonBody(generateSchema),
    responses: {
      201: jsonContent(z.object({ codes: z.array(inviteCodeSchema) }), 'Generated invite codes'),
      401: errorResponse('Unauthorized'),
    },
  },
)

const deleteRoute = authRoute(
  { scopes: [AuthorizationScope.INVITE_CODES_DELETE], siteRole: 'admin' },
  {
    operationId: 'deleteInviteCode',
    summary: 'Delete invite code',
    tags: ['Invite Codes'],
    method: 'delete',
    path: '/{id}',
    request: { params: z.object({ id: opaqueIdSchema }) },
    responses: {
      204: { description: 'Deleted invite code' },
      409: errorResponse('Cannot delete a used invite code'),
      404: errorResponse('Invite code not found'),
    },
  },
)

const validateRoute = authRoute(
  { public: true },
  {
    operationId: 'validateInviteCode',
    summary: 'Validate an invite code',
    tags: ['Invite Codes'],
    method: 'post',
    path: '/validations',
    request: jsonBody(validateSchema),
    responses: {
      200: jsonContent(z.object({ valid: z.boolean(), error: z.string().optional() }), 'Validation result'),
    },
  },
)

export const adminInviteCodes = new OpenAPIHono<Env>()
  .openapi(listRoute, async (c) => {
    const { page, pageSize } = c.req.valid('query')
    const result = await listInviteCodes(c.get('deps'), { page, pageSize })
    return c.json({ items: result.items.map(toInviteCodeDTO), total: result.total, page, pageSize }, 200)
  })
  .openapi(generateRoute, async (c) => {
    const userId = c.get('userId')
    if (!userId) throw unauthorized()
    const { count, expiresInDays } = c.req.valid('json')
    const result = await generateInviteCodes(c.get('deps'), { userId, count, expiresInDays })
    return c.json({ codes: result.codes.map(toInviteCodeDTO) }, 201)
  })
  .openapi(deleteRoute, async (c) => {
    const id = c.req.valid('param').id
    const result = await deleteInviteCode(c.get('deps'), { id })
    if (!result.ok) throw result.error
    return c.body(null, 204)
  })

export const publicInviteCodes = new OpenAPIHono<Env>().openapi(validateRoute, async (c) => {
  const { code } = c.req.valid('json')
  return c.json(await validateInviteCode(c.get('deps'), code), 200)
})
