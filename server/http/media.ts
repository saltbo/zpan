import { z } from '@hono/zod-openapi'
import { AuthorizationScope } from '@shared/authorization'
import { cursorPageQuerySchema, cursorPageSchema, movieMediaMetadataSchema, opaqueIdSchema } from '@shared/schemas'
import { ZPAN_CLOUD_URL_DEFAULT } from '../../shared/constants'
import { joinMatterPath } from '../domain/media-library'
import { listMovies, type MovieItem } from '../usecases/media'
import { badRequest } from '../usecases/ports'
import { authRoute, errorResponse, jsonContent } from './openapi'
import {
  createdAtIdCursorCodec,
  decodeOptionalPageToken,
  encodeNextPageToken,
  pageQueryFingerprint,
} from './page-token'
import { createRouter } from './router'

const movieSchema = z
  .object({
    id: opaqueIdSchema.describe("The video's matter id."),
    path: z.string().describe('Slash-delimited path of the video within the workspace.'),
    media: movieMediaMetadataSchema,
    posterUrl: z
      .string()
      .describe('Short-lived URL of the poster image. Absent when the poster is missing.')
      .optional(),
  })
  .openapi('Movie')

type MovieDTO = z.infer<typeof movieSchema>

function toMovieDTO(item: MovieItem): MovieDTO {
  return {
    id: item.matter.id,
    path: joinMatterPath(item.matter.parent, item.matter.name),
    media: item.media,
    ...(item.posterUrl ? { posterUrl: item.posterUrl } : {}),
  }
}

const listMoviesQuerySchema = cursorPageQuerySchema.extend({
  pageSize: z.coerce.number().int().min(1).max(100).default(24),
})

const listMoviesRoute = authRoute(
  { scopes: [AuthorizationScope.OBJECTS_READ], minTeamRole: 'viewer' },
  {
    operationId: 'listMovies',
    summary: 'List movies',
    description:
      "Lists the workspace's videos that carry movie media metadata, wherever they sit, newest first. The metadata is written by a downloader that scraped the download.",
    tags: ['Media'],
    method: 'get',
    path: '/movies',
    request: { query: listMoviesQuerySchema },
    responses: {
      200: jsonContent(cursorPageSchema(movieSchema, 'MoviePage'), 'Movies'),
      400: errorResponse('No active organization'),
    },
  },
)

const app = createRouter()

export const media = app.openapi(listMoviesRoute, async (c) => {
  const orgId = c.get('orgId')
  if (!orgId) throw badRequest('No active organization')
  const query = c.req.valid('query')
  const fingerprint = await pageQueryFingerprint({ orgId, kind: 'movie', pageSize: query.pageSize })
  const after = await decodeOptionalPageToken(c.get('platform'), query.pageToken, {
    query: fingerprint,
    codec: createdAtIdCursorCodec,
  })
  const result = await listMovies(c.get('deps'), {
    orgId,
    pageSize: query.pageSize,
    after,
    cloudBaseUrl: c.get('platform').getEnv('ZPAN_CLOUD_URL') ?? ZPAN_CLOUD_URL_DEFAULT,
  })
  return c.json(
    {
      items: result.items.map(toMovieDTO),
      nextPageToken: await encodeNextPageToken(c.get('platform'), result.nextBoundary, {
        query: fingerprint,
        codec: createdAtIdCursorCodec,
      }),
    },
    200,
  )
})
