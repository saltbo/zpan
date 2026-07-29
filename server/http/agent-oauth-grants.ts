import { OpenAPIHono, z } from '@hono/zod-openapi'
import { AuthorizationScope } from '@shared/authorization'
import { requireAuth } from '../middleware/auth'
import type { Env } from '../middleware/platform'
import { listAgentOAuthGrants, revokeAgentOAuthGrant } from '../usecases/agent-oauth-grants'
import { authRoute, errorResponse, jsonContent } from './openapi'

const agentOAuthGrantSchema = z.object({
  id: z.string(),
  clientId: z.string(),
  userId: z.string(),
  orgId: z.string(),
  scopes: z.array(z.enum(Object.values(AuthorizationScope) as [AuthorizationScope, ...AuthorizationScope[]])),
  createdAt: z.string(),
  updatedAt: z.string(),
})

const listSchema = z.object({ items: z.array(agentOAuthGrantSchema) })
const paramsSchema = z.object({ grantId: z.string().min(1) })

const listRoute = authRoute(
  { access: 'session' },
  {
    operationId: 'listAgentOAuthGrants',
    summary: 'List Agent OAuth grants',
    tags: ['Agent Access'],
    method: 'get',
    path: '/agent-oauth-grants',
    middleware: [requireAuth] as const,
    responses: {
      200: jsonContent(listSchema, 'Agent OAuth grants'),
    },
  },
)

const revokeRoute = authRoute(
  { access: 'session' },
  {
    operationId: 'revokeAgentOAuthGrant',
    summary: 'Revoke an Agent OAuth grant',
    tags: ['Agent Access'],
    method: 'delete',
    path: '/agent-oauth-grants/{grantId}',
    middleware: [requireAuth] as const,
    request: { params: paramsSchema },
    responses: {
      204: { description: 'Revoked' },
      404: errorResponse('Agent OAuth grant not found'),
    },
  },
)

export const agentOAuthGrants = new OpenAPIHono<Env>()
  .openapi(listRoute, async (c) => {
    const result = await listAgentOAuthGrants(c.get('deps'), c.get('platform').db, { userId: c.get('userId')! })
    return c.json(result, 200)
  })
  .openapi(revokeRoute, async (c) => {
    const { grantId } = c.req.valid('param')
    await revokeAgentOAuthGrant(c.get('deps'), c.get('platform').db, {
      userId: c.get('userId')!,
      grantId,
    })
    return c.body(null, 204)
  })
