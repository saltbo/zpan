import { OpenAPIHono, z } from '@hono/zod-openapi'
import { AuthorizationScope } from '@shared/authorization'
import { WORKSPACE_AUTHORIZATION_DETAIL_TYPE } from '@shared/oauth'
import { createLocalJWKSet, jwtVerify } from 'jose'
import type { Env } from '../middleware/platform'
import { listOAuthAuthorizationDetailsCatalog } from '../usecases/oauth-authorization-details'
import { unauthorized } from '../usecases/ports'
import { errorResponse, jsonContent } from './openapi'

const catalogEntrySchema = z.object({
  authorizationDetail: z.object({
    type: z.literal(WORKSPACE_AUTHORIZATION_DETAIL_TYPE),
    identifier: z.string().min(1),
  }),
  display: z.object({
    label: z.string(),
    metadata: z.record(z.string(), z.string()),
  }),
})

const paginationSchema = z.object({
  page: z.number().int().positive(),
  pageSize: z.number().int().positive(),
  totalItems: z.number().int().nonnegative(),
  totalPages: z.number().int().nonnegative(),
})

const catalogSchema = z
  .object({ items: z.array(catalogEntrySchema), pagination: paginationSchema })
  .openapi('AuthorizationDetailsCatalog')

const catalogRoute = {
  operationId: 'listAuthorizationDetailsCatalog',
  summary: 'List available authorization details',
  description:
    'Lists the workspace authorization details currently available to the connected user. This account-level endpoint accepts the OAuth subject credential and does not grant access to workspace files or data.',
  tags: ['OAuth'],
  method: 'get' as const,
  path: '/',
  security: [{ oauth2: [AuthorizationScope.WORKSPACES_DISCOVER] }],
  request: {
    query: z.object({
      page: z.coerce.number().int().min(1).default(1),
      pageSize: z.coerce.number().int().min(1).max(100).default(20),
    }),
  },
  responses: {
    200: {
      ...jsonContent(catalogSchema, 'Available workspace authorization details'),
      headers: {
        Link: {
          description: 'RFC 8288 links to applicable first, previous, next, and last catalog pages.',
          schema: { type: 'string' as const },
        },
      },
    },
    401: errorResponse('Invalid or expired account access token'),
    403: errorResponse('Missing workspace discovery scope'),
  },
}

export const oauthAuthorizationDetails = new OpenAPIHono<Env>().openapi(catalogRoute, async (c) => {
  const authorization = c.req.header('Authorization')
  const token = authorization?.startsWith('Bearer ') ? authorization.slice('Bearer '.length).trim() : ''
  if (!token) throw unauthorized('Unauthorized')

  const auth = c.get('auth')
  const authContext = await auth.$context
  const query = c.req.valid('query')
  const catalog = await listOAuthAuthorizationDetailsCatalog(c.get('deps'), {
    db: c.get('platform').db,
    token,
    ...query,
    verifyJwtToken: async () =>
      (
        await jwtVerify(token, createLocalJWKSet(await auth.api.getJwks()), {
          issuer: authContext.baseURL,
          audience: `${new URL(authContext.baseURL).origin}/api`,
        })
      ).payload,
  })
  c.header('Cache-Control', 'no-store')
  const link = catalogPaginationLink(c.req.url, catalog.pagination)
  if (link) c.header('Link', link)
  return c.json(catalog, 200)
})

function catalogPaginationLink(
  requestUrl: string,
  pagination: { page: number; pageSize: number; totalPages: number },
): string | null {
  if (pagination.totalPages === 0) return null

  const links: string[] = []
  const add = (page: number, relation: 'first' | 'prev' | 'next' | 'last') => {
    const url = new URL(requestUrl)
    url.search = ''
    url.searchParams.set('page', String(page))
    url.searchParams.set('pageSize', String(pagination.pageSize))
    links.push(`<${url.toString()}>; rel="${relation}"`)
  }

  if (pagination.page !== 1) add(1, 'first')
  if (pagination.page > 1) add(pagination.page - 1, 'prev')
  if (pagination.page < pagination.totalPages) add(pagination.page + 1, 'next')
  if (pagination.page !== pagination.totalPages) add(pagination.totalPages, 'last')
  return links.length > 0 ? links.join(', ') : null
}
