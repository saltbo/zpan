import { z } from '@hono/zod-openapi'
import { AuthorizationScope } from '@shared/authorization'
import {
  type AdminTorrent,
  adminTorrentSchema,
  cursorPageQuerySchema,
  cursorPageSchema,
  replaceTorrentCacheSettingsSchema,
  torrentCacheSettingsSchema,
} from '@shared/schemas'
import { requireFeature } from '../../middleware/require-feature'
import type { AdminTorrentRecord } from '../../usecases/ports'
import {
  evictCachedTorrent,
  getTorrentCacheSettings,
  listCachedTorrents,
  replaceTorrentCacheSettings,
} from '../../usecases/torrent-cache/admin'
import { authRoute, errorResponse, jsonBody, jsonContent } from '../openapi'
import {
  createdAtIdCursorCodec,
  decodeOptionalPageToken,
  encodeNextPageToken,
  pageQueryFingerprint,
} from '../page-token'
import { createRouter } from '../router'

function toAdminTorrentDTO(torrent: AdminTorrentRecord): AdminTorrent {
  return {
    id: torrent.id,
    infoHash: torrent.infoHash,
    name: torrent.name,
    totalSize: torrent.totalSize,
    fileCount: torrent.fileCount,
    status: torrent.status,
    verified: torrent.verified,
    holders: torrent.holders,
    lastAccessedAt: torrent.lastAccessedAt.toISOString(),
    createdAt: torrent.createdAt.toISOString(),
    sourceDownloader: torrent.sourceDownloaderId
      ? { id: torrent.sourceDownloaderId, name: torrent.sourceDownloaderName }
      : null,
  }
}

const torrentPageSchema = cursorPageSchema(adminTorrentSchema, 'AdminTorrentPage')

const listRoute = authRoute(
  { scopes: [AuthorizationScope.TORRENTS_READ], siteRole: 'admin' },
  {
    operationId: 'listCachedTorrents',
    summary: 'List cached torrents',
    tags: ['Torrent Cache'],
    method: 'get',
    path: '/',
    middleware: [requireFeature('torrent_cache')] as const,
    request: { query: cursorPageQuerySchema },
    responses: {
      200: jsonContent(torrentPageSchema, 'Cached torrents, newest first'),
      400: errorResponse('Invalid page token'),
    },
  },
)

const evictRoute = authRoute(
  { scopes: [AuthorizationScope.TORRENTS_DELETE], siteRole: 'admin' },
  {
    operationId: 'evictCachedTorrent',
    summary: 'Evict a cached torrent nobody holds',
    description:
      "Deletes the torrent's cached objects and rows. Refused with 409 while any drive file, live or in trash, holds it, or while it is downloading or verifying.",
    tags: ['Torrent Cache'],
    method: 'delete',
    path: '/{id}',
    middleware: [requireFeature('torrent_cache')] as const,
    request: { params: z.object({ id: z.string().min(1) }) },
    responses: {
      204: { description: 'Evicted' },
      404: errorResponse('Torrent not found'),
      409: errorResponse('The torrent is held or not in a final state'),
    },
  },
)

const getSettingsRoute = authRoute(
  { scopes: [AuthorizationScope.TORRENT_CACHE_SETTINGS_READ], siteRole: 'admin' },
  {
    operationId: 'getTorrentCacheSettings',
    summary: 'Get the torrent cache retention and capacity',
    tags: ['Torrent Cache'],
    method: 'get',
    path: '/',
    middleware: [requireFeature('torrent_cache')] as const,
    responses: { 200: jsonContent(torrentCacheSettingsSchema, 'Torrent cache settings') },
  },
)

const replaceSettingsRoute = authRoute(
  { scopes: [AuthorizationScope.TORRENT_CACHE_SETTINGS_UPDATE], siteRole: 'admin' },
  {
    operationId: 'replaceTorrentCacheSettings',
    summary: 'Replace the torrent cache retention and capacity',
    tags: ['Torrent Cache'],
    method: 'put',
    path: '/',
    middleware: [requireFeature('torrent_cache')] as const,
    request: jsonBody(replaceTorrentCacheSettingsSchema),
    responses: {
      200: jsonContent(torrentCacheSettingsSchema, 'Torrent cache settings'),
      400: errorResponse('Invalid settings'),
    },
  },
)

export const adminTorrents = createRouter()
  .openapi(listRoute, async (c) => {
    const { pageSize, pageToken } = c.req.valid('query')
    const page = {
      query: await pageQueryFingerprint({ resource: 'torrents', pageSize }),
      codec: createdAtIdCursorCodec,
    }
    const after = await decodeOptionalPageToken(c.get('platform'), pageToken, page)
    const result = await listCachedTorrents(c.get('deps'), { pageSize, after })
    return c.json(
      {
        items: result.items.map(toAdminTorrentDTO),
        nextPageToken: await encodeNextPageToken(c.get('platform'), result.nextBoundary, page),
      },
      200,
    )
  })
  .openapi(evictRoute, async (c) => {
    await evictCachedTorrent(c.get('deps'), c.req.valid('param').id)
    return c.body(null, 204)
  })

export const adminTorrentCacheSettings = createRouter()
  .openapi(getSettingsRoute, async (c) => {
    return c.json(await getTorrentCacheSettings(c.get('deps')), 200)
  })
  .openapi(replaceSettingsRoute, async (c) => {
    return c.json(await replaceTorrentCacheSettings(c.get('deps'), c.req.valid('json')), 200)
  })
