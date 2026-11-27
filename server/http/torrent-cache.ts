import { AuthorizationScope } from '@shared/authorization'
import { replaceTorrentCacheConfigSchema, torrentCacheConfigSchema } from '@shared/schemas'
import { notFound } from '../usecases/ports'
import { getTorrentFolder, replaceTorrentFolder } from '../usecases/torrent-cache/config'
import { authRoute, errorResponse, jsonBody, jsonContent } from './openapi'
import { createRouter } from './router'

function requireOrg(c: { get(key: 'orgId'): string | null }): string {
  const orgId = c.get('orgId')
  if (!orgId) throw notFound('No organization found')
  return orgId
}

const getRoute = authRoute(
  { scopes: [AuthorizationScope.TORRENT_CACHE_CONFIG_READ] },
  {
    operationId: 'getTorrentCacheConfig',
    summary: 'Get the workspace torrent settings',
    tags: ['Torrent Cache'],
    method: 'get',
    path: '/',
    responses: {
      200: jsonContent(torrentCacheConfigSchema, 'Workspace torrent settings'),
      401: errorResponse('Unauthorized'),
    },
  },
)

const replaceRoute = authRoute(
  { scopes: [AuthorizationScope.TORRENT_CACHE_CONFIG_UPDATE], minTeamRole: 'owner' },
  {
    operationId: 'replaceTorrentCacheConfig',
    summary: 'Replace the workspace torrent settings',
    tags: ['Torrent Cache'],
    method: 'put',
    path: '/',
    request: jsonBody(replaceTorrentCacheConfigSchema),
    responses: {
      200: jsonContent(torrentCacheConfigSchema, 'Workspace torrent settings'),
      400: errorResponse('Folder is invalid'),
      401: errorResponse('Unauthorized'),
      403: errorResponse('Only workspace admins and owners can change it'),
    },
  },
)

export const torrentCacheConfig = createRouter()
  .openapi(getRoute, async (c) => {
    const folder = await getTorrentFolder(c.get('deps'), requireOrg(c))
    return c.json({ folder }, 200)
  })
  .openapi(replaceRoute, async (c) => {
    const folder = await replaceTorrentFolder(c.get('deps'), requireOrg(c), c.req.valid('json').folder)
    return c.json({ folder }, 200)
  })
