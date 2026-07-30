import { OpenAPIHono, z } from '@hono/zod-openapi'
import { AGENT_OAUTH_RESOURCE_SCOPES, AGENT_OAUTH_SCOPE_DESCRIPTIONS } from '@shared/agent-oauth'
import type { Env } from '../middleware/platform'
import { authRoute, jsonContent } from './openapi'

const scopeSchema = z.object({
  value: z.string(),
  description: z.string(),
})

const route = authRoute(
  { public: true },
  {
    operationId: 'listOAuthResourceScopes',
    summary: 'List OAuth resource scopes',
    description:
      'Public scope catalog for external authorization controllers. Runtime API operations remain protected by their x-zpan-auth declarations.',
    tags: ['OAuth'],
    method: 'get',
    path: '/',
    responses: {
      200: jsonContent(z.object({ scopes: z.array(scopeSchema) }), 'OAuth resource scope catalog'),
    },
  },
)

// FlareAuth derives requestable business scopes from standard OAuth operation
// security. The empty alternative truthfully documents that this catalog
// endpoint itself is public. Protected business operations remain unbound so a
// delegated credential hook can sign them before Restish's built-in auth runs.
const scopeCatalogSecurity: Record<string, string[]>[] = [{ agentOAuth2: [...AGENT_OAUTH_RESOURCE_SCOPES] }, {}]
const scopeCatalogRoute = Object.assign(route, {
  security: scopeCatalogSecurity,
  'x-mcp-ignore': true,
})

export const oauthResourceScopes = new OpenAPIHono<Env>().openapi(scopeCatalogRoute, (c) =>
  c.json(
    {
      scopes: AGENT_OAUTH_RESOURCE_SCOPES.map((value) => ({
        value,
        description: AGENT_OAUTH_SCOPE_DESCRIPTIONS[value],
      })),
    },
    200,
  ),
)
