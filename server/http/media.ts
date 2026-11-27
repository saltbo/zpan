import { z } from '@hono/zod-openapi'
import { AuthorizationScope } from '@shared/authorization'
import {
  cursorPageQuerySchema,
  cursorPageSchema,
  episodeMediaMetadataSchema,
  movieMediaMetadataSchema,
  opaqueIdSchema,
  tvShowMediaMetadataSchema,
} from '@shared/schemas'
import type { Context } from 'hono'
import { ZPAN_CLOUD_URL_DEFAULT } from '../../shared/constants'
import { joinMatterPath } from '../domain/media-library'
import type { Env } from '../middleware/platform'
import {
  type EpisodeItem,
  getShow,
  listMovies,
  listShowEpisodes,
  listShows,
  type MovieItem,
  type ShowItem,
} from '../usecases/media'
import { badRequest, type EpisodePageBoundary } from '../usecases/ports'
import { authRoute, errorResponse, jsonContent } from './openapi'
import {
  createdAtIdCursorCodec,
  decodeOptionalPageToken,
  encodeNextPageToken,
  type PageCursorCodec,
  pageQueryFingerprint,
} from './page-token'
import { createRouter } from './router'

const pathField = z.string().describe('Slash-delimited path within the workspace.')

const movieSchema = z
  .object({
    id: opaqueIdSchema.describe("The video's matter id."),
    path: pathField,
    media: movieMediaMetadataSchema,
    posterUrl: z
      .string()
      .describe('Short-lived URL of the poster image. Absent when the poster is missing.')
      .optional(),
  })
  .openapi('Movie')

const showSchema = z
  .object({
    id: opaqueIdSchema.describe("The show folder's matter id."),
    path: pathField,
    media: tvShowMediaMetadataSchema,
    posterUrl: z
      .string()
      .describe('Short-lived URL of the poster image. Absent when the poster is missing.')
      .optional(),
  })
  .openapi('Show')

const episodeSchema = z
  .object({
    id: opaqueIdSchema.describe("The video's matter id."),
    path: pathField,
    media: episodeMediaMetadataSchema,
    stillUrl: z.string().describe('Short-lived URL of the episode still. Absent when the still is missing.').optional(),
  })
  .openapi('Episode')

function toMovieDTO(item: MovieItem): z.infer<typeof movieSchema> {
  return {
    id: item.matter.id,
    path: joinMatterPath(item.matter.parent, item.matter.name),
    media: item.media,
    ...(item.posterUrl ? { posterUrl: item.posterUrl } : {}),
  }
}

function toShowDTO(item: ShowItem): z.infer<typeof showSchema> {
  return {
    id: item.matter.id,
    path: joinMatterPath(item.matter.parent, item.matter.name),
    media: item.media,
    ...(item.posterUrl ? { posterUrl: item.posterUrl } : {}),
  }
}

function toEpisodeDTO(item: EpisodeItem): z.infer<typeof episodeSchema> {
  return {
    id: item.matter.id,
    path: joinMatterPath(item.matter.parent, item.matter.name),
    media: item.media,
    ...(item.stillUrl ? { stillUrl: item.stillUrl } : {}),
  }
}

const episodeCursorCodec: PageCursorCodec<EpisodePageBoundary> = {
  decode(boundary) {
    const { season, episode, id } = boundary
    if (typeof season !== 'number' || typeof episode !== 'number' || typeof id !== 'string') return undefined
    return { season, episode, id }
  },
  encode(cursor) {
    return { season: cursor.season, episode: cursor.episode, id: cursor.id }
  },
}

const mediaPageQuerySchema = cursorPageQuerySchema.extend({
  pageSize: z.coerce.number().int().min(1).max(100).default(24),
})

const episodePageQuerySchema = cursorPageQuerySchema.extend({
  pageSize: z.coerce.number().int().min(1).max(100).default(50),
})

const access = { scopes: [AuthorizationScope.OBJECTS_READ], minTeamRole: 'viewer' } as const

const listMoviesRoute = authRoute(access, {
  operationId: 'listMovies',
  summary: 'List movies',
  description:
    "Lists the workspace's videos that carry movie media metadata, wherever they sit, newest first. The metadata is written by a downloader that scraped the download.",
  tags: ['Media'],
  method: 'get',
  path: '/movies',
  request: { query: mediaPageQuerySchema },
  responses: {
    200: jsonContent(cursorPageSchema(movieSchema, 'MoviePage'), 'Movies'),
    400: errorResponse('No active organization'),
  },
})

const listShowsRoute = authRoute(access, {
  operationId: 'listShows',
  summary: 'List TV shows',
  description:
    "Lists the workspace's folders that carry TV show media metadata, wherever they sit, newest first. The metadata is written by a downloader that scraped a download of the show's episodes.",
  tags: ['Media'],
  method: 'get',
  path: '/shows',
  request: { query: mediaPageQuerySchema },
  responses: {
    200: jsonContent(cursorPageSchema(showSchema, 'ShowPage'), 'TV shows'),
    400: errorResponse('No active organization'),
  },
})

const showParams = z.object({ id: opaqueIdSchema.describe("The show folder's matter id.") })

const getShowRoute = authRoute(access, {
  operationId: 'getShow',
  summary: 'Get a TV show',
  description: 'Returns one folder that carries TV show media metadata.',
  tags: ['Media'],
  method: 'get',
  path: '/shows/{id}',
  request: { params: showParams },
  responses: {
    200: jsonContent(showSchema, 'TV show'),
    400: errorResponse('No active organization'),
    404: errorResponse('Show not found'),
  },
})

const listShowEpisodesRoute = authRoute(access, {
  operationId: 'listShowEpisodes',
  summary: 'List the episodes of a TV show',
  description:
    'Lists the videos that carry episode media metadata anywhere inside a show folder, ordered by season and then episode number.',
  tags: ['Media'],
  method: 'get',
  path: '/shows/{id}/episodes',
  request: {
    params: showParams,
    query: episodePageQuerySchema,
  },
  responses: {
    200: jsonContent(cursorPageSchema(episodeSchema, 'EpisodePage'), 'Episodes'),
    400: errorResponse('No active organization'),
    404: errorResponse('Show not found'),
  },
})

function mediaParams(c: Context<Env>) {
  const orgId = c.get('orgId')
  if (!orgId) throw badRequest('No active organization')
  return { orgId, cloudBaseUrl: c.get('platform').getEnv('ZPAN_CLOUD_URL') ?? ZPAN_CLOUD_URL_DEFAULT }
}

const app = createRouter()

export const media = app
  .openapi(listMoviesRoute, async (c) => {
    const params = mediaParams(c)
    const query = c.req.valid('query')
    const fingerprint = await pageQueryFingerprint({ orgId: params.orgId, kind: 'movie', pageSize: query.pageSize })
    const tokenInput = { query: fingerprint, codec: createdAtIdCursorCodec }
    const after = await decodeOptionalPageToken(c.get('platform'), query.pageToken, tokenInput)
    const result = await listMovies(c.get('deps'), { ...params, pageSize: query.pageSize, after })
    return c.json(
      {
        items: result.items.map(toMovieDTO),
        nextPageToken: await encodeNextPageToken(c.get('platform'), result.nextBoundary, tokenInput),
      },
      200,
    )
  })
  .openapi(listShowsRoute, async (c) => {
    const params = mediaParams(c)
    const query = c.req.valid('query')
    const fingerprint = await pageQueryFingerprint({ orgId: params.orgId, kind: 'tvshow', pageSize: query.pageSize })
    const tokenInput = { query: fingerprint, codec: createdAtIdCursorCodec }
    const after = await decodeOptionalPageToken(c.get('platform'), query.pageToken, tokenInput)
    const result = await listShows(c.get('deps'), { ...params, pageSize: query.pageSize, after })
    return c.json(
      {
        items: result.items.map(toShowDTO),
        nextPageToken: await encodeNextPageToken(c.get('platform'), result.nextBoundary, tokenInput),
      },
      200,
    )
  })
  .openapi(getShowRoute, async (c) => {
    const { id } = c.req.valid('param')
    return c.json(toShowDTO(await getShow(c.get('deps'), { ...mediaParams(c), showId: id })), 200)
  })
  .openapi(listShowEpisodesRoute, async (c) => {
    const params = mediaParams(c)
    const { id } = c.req.valid('param')
    const query = c.req.valid('query')
    const fingerprint = await pageQueryFingerprint({
      orgId: params.orgId,
      kind: 'episode',
      showId: id,
      pageSize: query.pageSize,
    })
    const tokenInput = { query: fingerprint, codec: episodeCursorCodec }
    const after = await decodeOptionalPageToken(c.get('platform'), query.pageToken, tokenInput)
    const result = await listShowEpisodes(c.get('deps'), { ...params, showId: id, pageSize: query.pageSize, after })
    return c.json(
      {
        items: result.items.map(toEpisodeDTO),
        nextPageToken: await encodeNextPageToken(c.get('platform'), result.nextBoundary, tokenInput),
      },
      200,
    )
  })
