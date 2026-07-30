import { OpenAPIHono, z } from '@hono/zod-openapi'
import { AuthorizationScope } from '@shared/authorization'
import {
  agentApiKeyCreatedSchema,
  agentApiKeyCreateSchema,
  agentApiKeyListSchema,
  agentApiKeyRotateSchema,
} from '@shared/schemas'
import type { Env } from '../middleware/platform'
import { createAgentApiKey, listAgentApiKeys, revokeAgentApiKey, rotateAgentApiKey } from '../usecases/agent-api-keys'
import { authRoute, errorResponse, jsonBody, jsonContent } from './openapi'

const workspaceParamsSchema = z.object({ orgId: z.string().min(1) })
const keyParamsSchema = workspaceParamsSchema.extend({ keyId: z.string().min(1) })
const listQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(50),
})

const listRoute = authRoute(
  { scopes: [AuthorizationScope.AGENT_API_KEYS_READ] },
  {
    operationId: 'listWorkspaceAgentApiKeys',
    summary: 'List Agent API keys for a workspace',
    tags: ['Agent Access'],
    method: 'get',
    path: '/{orgId}/agent-api-keys',
    request: { params: workspaceParamsSchema, query: listQuerySchema },
    responses: {
      200: jsonContent(agentApiKeyListSchema, 'Agent API keys'),
      403: errorResponse('Forbidden'),
    },
  },
)

const createRoute = authRoute(
  { scopes: [AuthorizationScope.AGENT_API_KEYS_CREATE] },
  {
    operationId: 'createWorkspaceAgentApiKey',
    summary: 'Create an Agent API key for a workspace',
    tags: ['Agent Access'],
    method: 'post',
    path: '/{orgId}/agent-api-keys',
    request: { params: workspaceParamsSchema, ...jsonBody(agentApiKeyCreateSchema) },
    responses: {
      201: jsonContent(agentApiKeyCreatedSchema, 'Created Agent API key'),
      400: errorResponse('Bad request'),
      403: errorResponse('Forbidden'),
    },
  },
)

const rotateRoute = authRoute(
  { scopes: [AuthorizationScope.AGENT_API_KEYS_UPDATE] },
  {
    operationId: 'rotateWorkspaceAgentApiKey',
    summary: 'Rotate an Agent API key for a workspace',
    tags: ['Agent Access'],
    method: 'post',
    path: '/{orgId}/agent-api-keys/{keyId}/rotations',
    request: { params: keyParamsSchema, ...jsonBody(agentApiKeyRotateSchema) },
    responses: {
      201: jsonContent(agentApiKeyCreatedSchema, 'Rotated Agent API key'),
      400: errorResponse('Bad request'),
      409: errorResponse('Agent API key is not active'),
      403: errorResponse('Forbidden'),
      404: errorResponse('Agent API key not found'),
    },
  },
)

const revokeRoute = authRoute(
  { scopes: [AuthorizationScope.AGENT_API_KEYS_DELETE] },
  {
    operationId: 'revokeWorkspaceAgentApiKey',
    summary: 'Revoke an Agent API key for a workspace',
    tags: ['Agent Access'],
    method: 'delete',
    path: '/{orgId}/agent-api-keys/{keyId}',
    request: { params: keyParamsSchema },
    responses: {
      204: { description: 'Revoked' },
      403: errorResponse('Forbidden'),
      404: errorResponse('Agent API key not found'),
    },
  },
)

const agentApiKeys = new OpenAPIHono<Env>()
  .openapi(listRoute, async (c) => {
    const { orgId } = c.req.valid('param')
    const { page, pageSize } = c.req.valid('query')
    const result = await listAgentApiKeys(c.get('deps'), c.get('platform').db, {
      userId: c.get('userId')!,
      orgId,
      page,
      pageSize,
    })
    return c.json(result, 200)
  })
  .openapi(createRoute, async (c) => {
    const { orgId } = c.req.valid('param')
    const result = await createAgentApiKey(c.get('deps'), c.get('platform').db, {
      userId: c.get('userId')!,
      orgId,
      body: c.req.valid('json'),
    })
    return c.json(result, 201)
  })
  .openapi(rotateRoute, async (c) => {
    const { orgId, keyId } = c.req.valid('param')
    const result = await rotateAgentApiKey(c.get('deps'), c.get('platform').db, {
      userId: c.get('userId')!,
      orgId,
      keyId,
      body: c.req.valid('json'),
    })
    return c.json(result, 201)
  })
  .openapi(revokeRoute, async (c) => {
    const { orgId, keyId } = c.req.valid('param')
    await revokeAgentApiKey(c.get('deps'), c.get('platform').db, {
      userId: c.get('userId')!,
      orgId,
      keyId,
    })
    return c.body(null, 204)
  })

export default agentApiKeys
