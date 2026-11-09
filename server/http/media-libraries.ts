import { OpenAPIHono, z } from '@hono/zod-openapi'
import { AuthorizationScope } from '@shared/authorization'
import {
  createMediaLibraryRequestSchema,
  cursorPageQuerySchema,
  cursorPageSchema,
  type MediaLibrary,
  mediaLibrarySchema,
  opaqueIdSchema,
} from '@shared/schemas'
import type { Context } from 'hono'
import { authzActorIdentity, type Env } from '../middleware/platform'
import { requireFeature } from '../middleware/require-feature'
import { backgroundJobsEnabled } from '../platform/interface'
import {
  createMediaLibrary,
  deleteMediaLibrary,
  listMediaLibraries,
  scanMediaLibrary,
  scrapeMediaLibrary,
} from '../usecases/media-library'
import { backgroundJobsUnavailable, type MediaLibraryView, notFound } from '../usecases/ports'
import { backgroundJobSchema } from './background-jobs'
import { authRoute, errorResponse, jsonBody, jsonContent } from './openapi'
import {
  createdAtIdCursorCodec,
  decodeOptionalPageToken,
  encodeNextPageToken,
  pageQueryFingerprint,
} from './page-token'

function toMediaLibraryDTO(library: MediaLibraryView): MediaLibrary {
  return {
    id: library.id,
    orgId: library.orgId,
    folderId: library.folderId,
    folderPath: library.folder.path,
    scanning: library.scanning,
    scraping: library.scraping,
    lastScannedAt: library.lastScannedAt?.toISOString() ?? null,
    createdBy: library.createdBy,
    createdAt: library.createdAt.toISOString(),
    updatedAt: library.updatedAt.toISOString(),
  }
}

function requireOrg(c: { get(key: 'orgId'): string | null }): string {
  const orgId = c.get('orgId')
  if (!orgId) throw notFound('No organization found')
  return orgId
}

function requester(c: Context<Env>) {
  const userId = c.get('userId')
  const createdBy = authzActorIdentity(c.get('authzContext'))
  if (!userId || !createdBy) throw new Error('authenticated_actor_missing')
  return { orgId: requireOrg(c), userId, createdBy }
}

const mediaLibraryParams = z.object({ id: opaqueIdSchema })

const listRoute = authRoute(
  { scopes: [AuthorizationScope.MEDIA_LIBRARIES_READ] },
  {
    operationId: 'listMediaLibraries',
    summary: 'List media libraries',
    tags: ['Media Libraries'],
    method: 'get',
    path: '/',
    request: { query: cursorPageQuerySchema },
    responses: {
      200: jsonContent(cursorPageSchema(mediaLibrarySchema, 'MediaLibraryPage'), 'Media libraries'),
    },
  },
)

const createRoute = authRoute(
  { scopes: [AuthorizationScope.MEDIA_LIBRARIES_CREATE], minTeamRole: 'editor' },
  {
    operationId: 'createMediaLibrary',
    summary: 'Mark a folder as a media library',
    description:
      'Writes `<folder>/library.json` (JSON Feed 1.1) and queues the first scan to fill it. The index also marks the folder as a media library: deleting, renaming, or moving it turns the library off.',
    tags: ['Media Libraries'],
    method: 'post',
    path: '/',
    middleware: [requireFeature('media_library')] as const,
    request: jsonBody(createMediaLibraryRequestSchema),
    responses: {
      201: jsonContent(mediaLibrarySchema, 'Created media library'),
      400: errorResponse('The target is not a folder'),
      402: errorResponse('Media libraries require a Pro or Business license'),
      404: errorResponse('Folder not found'),
      409: errorResponse(
        'The folder already is, contains, or is inside a media library, or already holds an entry named library.json',
      ),
      422: errorResponse('The index does not fit the storage quota'),
      503: errorResponse('Background jobs are unavailable in this environment'),
    },
  },
)

const deleteRoute = authRoute(
  { scopes: [AuthorizationScope.MEDIA_LIBRARIES_DELETE], minTeamRole: 'editor' },
  {
    operationId: 'deleteMediaLibrary',
    summary: 'Remove a media library',
    description: 'Permanently deletes the `library.json` index. The folder and its videos are left in place.',
    tags: ['Media Libraries'],
    method: 'delete',
    path: '/{id}',
    request: { params: mediaLibraryParams },
    responses: {
      204: { description: 'Media library removed' },
      404: errorResponse('Media library not found'),
    },
  },
)

const scanRoute = authRoute(
  { scopes: [AuthorizationScope.MEDIA_LIBRARIES_UPDATE], minTeamRole: 'editor' },
  {
    operationId: 'createMediaLibraryScan',
    summary: 'Rescan a media library',
    tags: ['Media Libraries'],
    method: 'post',
    path: '/{id}/scans',
    middleware: [requireFeature('media_library')] as const,
    request: { params: mediaLibraryParams },
    responses: {
      201: jsonContent(backgroundJobSchema, 'Queued scan job'),
      402: errorResponse('Media libraries require a Pro or Business license'),
      404: errorResponse('Media library not found'),
      409: errorResponse('A scan is already queued or running, or the folder is unavailable'),
      503: errorResponse('Background jobs are unavailable in this environment'),
    },
  },
)

const scrapeRoute = authRoute(
  { scopes: [AuthorizationScope.MEDIA_LIBRARIES_UPDATE], minTeamRole: 'editor' },
  {
    operationId: 'createMediaLibraryScrape',
    summary: 'Scrape TMDB metadata for a media library',
    description:
      'Matches the videos that were never scraped, changed since, or were scraped in another language to TMDB. Writes Kodi/Jellyfin `.nfo` and artwork sidecars next to them without replacing existing files, and adds each match as `_media.tmdb` in `library.json` on the next scan.',
    tags: ['Media Libraries'],
    method: 'post',
    path: '/{id}/scrapes',
    middleware: [requireFeature('media_library')] as const,
    request: { params: mediaLibraryParams },
    responses: {
      201: jsonContent(backgroundJobSchema, 'Queued scrape job'),
      402: errorResponse('Media libraries require a Pro or Business license'),
      404: errorResponse('Media library not found'),
      409: errorResponse('A scrape is already queued or running, or the folder is unavailable'),
      412: errorResponse('TMDB is not configured'),
      503: errorResponse('Background jobs are unavailable in this environment'),
    },
  },
)

const app = new OpenAPIHono<Env>()

export const mediaLibraries = app
  .openapi(listRoute, async (c) => {
    const orgId = requireOrg(c)
    const query = c.req.valid('query')
    const fingerprint = await pageQueryFingerprint({ orgId, pageSize: query.pageSize })
    const after = await decodeOptionalPageToken(c.get('platform'), query.pageToken, {
      query: fingerprint,
      codec: createdAtIdCursorCodec,
    })
    const result = await listMediaLibraries(c.get('deps'), orgId, { pageSize: query.pageSize, after })
    return c.json(
      {
        items: result.items.map(toMediaLibraryDTO),
        nextPageToken: await encodeNextPageToken(c.get('platform'), result.nextBoundary, {
          query: fingerprint,
          codec: createdAtIdCursorCodec,
        }),
      },
      200,
    )
  })
  .openapi(createRoute, async (c) => {
    if (!backgroundJobsEnabled(c.get('platform'))) throw backgroundJobsUnavailable()
    const library = await createMediaLibrary(c.get('deps'), { ...requester(c), folderId: c.req.valid('json').folderId })
    return c.json(toMediaLibraryDTO(library), 201)
  })
  .openapi(deleteRoute, async (c) => {
    await deleteMediaLibrary(c.get('deps'), requireOrg(c), c.req.valid('param').id)
    return c.body(null, 204)
  })
  .openapi(scanRoute, async (c) => {
    if (!backgroundJobsEnabled(c.get('platform'))) throw backgroundJobsUnavailable()
    const job = await scanMediaLibrary(c.get('deps'), { ...requester(c), libraryId: c.req.valid('param').id })
    return c.json(job, 201)
  })
  .openapi(scrapeRoute, async (c) => {
    if (!backgroundJobsEnabled(c.get('platform'))) throw backgroundJobsUnavailable()
    const job = await scrapeMediaLibrary(c.get('deps'), { ...requester(c), libraryId: c.req.valid('param').id })
    return c.json(job, 201)
  })
