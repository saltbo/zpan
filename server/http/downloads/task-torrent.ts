// The torrent cache upload API: a downloader that reported the `torrent-cache`
// capability and was assigned a task in cache mode (assignment.torrentCache)
// uploads through these routes, authorized by the task's upload token, instead of
// the object API (docs/design/torrent-cache.md §6).

import { z } from '@hono/zod-openapi'
import { AuthorizationScope } from '@shared/authorization'
import {
  completeTaskTorrentSchema,
  completeTorrentFileUploadSchema,
  createTorrentSidecarUploadSchema,
  downloadTaskSchema,
  opaqueIdSchema,
  registerTaskTorrentSchema,
  TORRENT_LAYOUT_MAX_BYTES,
  TORRENT_SIDECAR_MAX_COUNT,
  taskTorrentRegistrationSchema,
  torrentFileUploadSchema,
  torrentLayoutSchema,
} from '@shared/schemas'
import { bodyLimit } from 'hono/body-limit'
import { jsonError } from '../../middleware/error-handler'
import type { AuthPrincipal } from '../../middleware/platform'
import { backgroundJobsEnabled } from '../../platform/interface'
import { getDownloadTask } from '../../usecases/downloads/downloads'
import { forbidden, payloadTooLarge } from '../../usecases/ports'
import { completeTaskTorrent } from '../../usecases/torrent-cache/complete'
import {
  completeTorrentFileUpload,
  createTorrentFileUpload,
  registerTaskTorrent,
} from '../../usecases/torrent-cache/fill'
import {
  completeTorrentSidecarUpload,
  createTorrentSidecarUpload,
  putTaskTorrentLayout,
} from '../../usecases/torrent-cache/layout-upload'
import { authRoute, errorResponse, jsonBody, jsonContent } from '../openapi'
import { createRouter } from '../router'

const policy = {
  scopes: [AuthorizationScope.OBJECTS_CREATE],
  credential: 'download-task-upload',
  taskUpload: true,
} as const

const taskParams = z.object({ id: opaqueIdSchema })
const fileParams = z.object({ id: opaqueIdSchema, fileIdx: z.coerce.number().int().min(0) })

const sidecarParams = z.object({
  id: opaqueIdSchema,
  n: z.coerce
    .number()
    .int()
    .min(0)
    .max(TORRENT_SIDECAR_MAX_COUNT - 1),
})

const errors = {
  400: errorResponse('Metadata or files do not match the torrent'),
  401: errorResponse('Unauthorized'),
  403: errorResponse('Forbidden'),
  404: errorResponse('Not found'),
  409: errorResponse('Task is not filling the torrent cache'),
}

const registerRoute = authRoute(policy, {
  operationId: 'registerTaskTorrent',
  summary: "Register a cache download's info dictionary",
  description:
    "Uploads the torrent's bencoded info dictionary. Its SHA-1 must equal the task's infoHash. The outcome says whether to upload the files into the cache, drop the task, or upload into the drive.",
  tags: ['Download Tasks'],
  method: 'put',
  path: '/{id}/torrent',
  request: { params: taskParams, ...jsonBody(registerTaskTorrentSchema) },
  responses: { 200: jsonContent(taskTorrentRegistrationSchema, 'Registration outcome'), ...errors },
})

const createFileUploadRoute = authRoute(policy, {
  operationId: 'createTorrentFileUpload',
  summary: 'Start uploading a torrent file into the cache',
  tags: ['Download Tasks'],
  method: 'post',
  path: '/{id}/torrent/files/{fileIdx}/uploads',
  request: { params: fileParams },
  responses: { 201: jsonContent(torrentFileUploadSchema, 'Presigned upload'), ...errors },
})

const completeFileUploadRoute = authRoute(policy, {
  operationId: 'completeTorrentFileUpload',
  summary: 'Complete a torrent file upload',
  tags: ['Download Tasks'],
  method: 'post',
  path: '/{id}/torrent/files/{fileIdx}/completions',
  request: { params: fileParams, ...jsonBody(completeTorrentFileUploadSchema) },
  responses: {
    200: jsonContent(z.object({ fileIdx: z.number().int(), size: z.number().int() }), 'Uploaded file'),
    ...errors,
  },
})

const createSidecarUploadRoute = authRoute(policy, {
  operationId: 'createTorrentSidecarUpload',
  summary: 'Start uploading a sidecar into the cache',
  description:
    'Presigns a single PUT for a sidecar the scraper wrote (an .nfo or an image), stored as bt/<infoHash>/x/<n> beside the torrent.',
  tags: ['Download Tasks'],
  method: 'post',
  path: '/{id}/torrent/sidecars/{n}/uploads',
  request: { params: sidecarParams, ...jsonBody(createTorrentSidecarUploadSchema) },
  responses: { 201: jsonContent(torrentFileUploadSchema, 'Presigned upload'), ...errors },
})

const completeSidecarUploadRoute = authRoute(policy, {
  operationId: 'completeTorrentSidecarUpload',
  summary: 'Complete a sidecar upload',
  tags: ['Download Tasks'],
  method: 'post',
  path: '/{id}/torrent/sidecars/{n}/completions',
  request: { params: sidecarParams },
  responses: {
    200: jsonContent(z.object({ n: z.number().int(), size: z.number().int() }), 'Uploaded sidecar'),
    ...errors,
  },
})

const putLayoutRoute = authRoute(policy, {
  operationId: 'putTaskTorrentLayout',
  summary: "Store a scraped cache download's upload layout",
  description:
    'Stores the upload plan as bt/<infoHash>/layout.json, which every instant transfer of the torrent replays. Every torrent file it names must be in the torrent and every sidecar uploaded.',
  tags: ['Download Tasks'],
  method: 'put',
  path: '/{id}/torrent/layout',
  middleware: [
    bodyLimit({
      maxSize: TORRENT_LAYOUT_MAX_BYTES,
      onError: (c) => jsonError(c, payloadTooLarge('Layout is too large')),
    }),
  ] as const,
  request: { params: taskParams, ...jsonBody(torrentLayoutSchema) },
  responses: {
    200: jsonContent(z.object({ entries: z.number().int() }), 'Stored layout'),
    ...errors,
    413: errorResponse('Layout is larger than 8 MiB'),
  },
})

const completeRoute = authRoute(policy, {
  operationId: 'completeTaskTorrent',
  summary: 'Complete a cache download',
  description:
    'Checks the uploaded files against the info dictionary, queues piece verification, and completes the task by instant transfer into its folder.',
  tags: ['Download Tasks'],
  method: 'post',
  path: '/{id}/torrent/completions',
  request: { params: taskParams, ...jsonBody(completeTaskTorrentSchema) },
  responses: { 200: jsonContent(downloadTaskSchema, 'Completed download task'), ...errors },
})

function uploader(principal: AuthPrincipal | null, taskId: string): { taskId: string; downloaderId: string } {
  if (principal?.kind !== 'download-task-upload' || principal.taskId !== taskId) throw forbidden()
  return { taskId, downloaderId: principal.downloaderId }
}

export const taskTorrentRoute = createRouter()
  .openapi(registerRoute, async (c) => {
    const { id } = c.req.valid('param')
    const result = await registerTaskTorrent(c.get('deps'), {
      ...uploader(c.get('principal'), id),
      info: c.req.valid('json').info,
    })
    return c.json(result, 200)
  })
  .openapi(createFileUploadRoute, async (c) => {
    const { id, fileIdx } = c.req.valid('param')
    return c.json(await createTorrentFileUpload(c.get('deps'), { ...uploader(c.get('principal'), id), fileIdx }), 201)
  })
  .openapi(completeFileUploadRoute, async (c) => {
    const { id, fileIdx } = c.req.valid('param')
    const input = c.req.valid('json')
    return c.json(
      await completeTorrentFileUpload(c.get('deps'), { ...uploader(c.get('principal'), id), fileIdx, input }),
      200,
    )
  })
  .openapi(createSidecarUploadRoute, async (c) => {
    const { id, n } = c.req.valid('param')
    const { size } = c.req.valid('json')
    return c.json(
      await createTorrentSidecarUpload(c.get('deps'), { ...uploader(c.get('principal'), id), n, size }),
      201,
    )
  })
  .openapi(completeSidecarUploadRoute, async (c) => {
    const { id, n } = c.req.valid('param')
    return c.json(await completeTorrentSidecarUpload(c.get('deps'), { ...uploader(c.get('principal'), id), n }), 200)
  })
  .openapi(putLayoutRoute, async (c) => {
    const { id } = c.req.valid('param')
    const layout = c.req.valid('json')
    return c.json(await putTaskTorrentLayout(c.get('deps'), { ...uploader(c.get('principal'), id), layout }), 200)
  })
  .openapi(completeRoute, async (c) => {
    const { id } = c.req.valid('param')
    const deps = c.get('deps')
    await completeTaskTorrent(deps, {
      ...uploader(c.get('principal'), id),
      input: c.req.valid('json'),
      backgroundJobs: backgroundJobsEnabled(c.get('platform')),
    })
    return c.json(await getDownloadTask(deps, c.get('orgId') as string, id), 200)
  })
