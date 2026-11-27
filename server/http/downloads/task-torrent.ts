// The torrent upload API: a downloader that reported the fill capability and
// was assigned a task as a torrent's fill (assignment.torrentCache) uploads the
// torrent's files through these routes, authorized by the task's upload token,
// instead of the object API. One upload path replaces it
// (docs/design/torrents.md §14).

import { z } from '@hono/zod-openapi'
import { AuthorizationScope } from '@shared/authorization'
import {
  completeTaskTorrentSchema,
  completeTorrentFileUploadSchema,
  downloadTaskSchema,
  opaqueIdSchema,
  registerTaskTorrentSchema,
  taskTorrentRegistrationSchema,
  torrentFileUploadSchema,
} from '@shared/schemas'
import type { AuthPrincipal } from '../../middleware/platform'
import { backgroundJobsEnabled } from '../../platform/interface'
import { getDownloadTask } from '../../usecases/downloads/downloads'
import { forbidden } from '../../usecases/ports'
import { completeTaskTorrent } from '../../usecases/torrents/complete'
import {
  abortTorrentFileUpload,
  completeTorrentFileUpload,
  createTorrentFileUpload,
  registerTaskTorrent,
} from '../../usecases/torrents/fill'
import { authRoute, errorResponse, jsonBody, jsonContent } from '../openapi'
import { createRouter } from '../router'

const policy = {
  scopes: [AuthorizationScope.OBJECTS_CREATE],
  credential: 'download-task-upload',
  taskUpload: true,
} as const

const taskParams = z.object({ id: opaqueIdSchema })
const fileParams = z.object({ id: opaqueIdSchema, fileIdx: z.coerce.number().int().min(0) })

const errors = {
  400: errorResponse('Metadata or files do not match the torrent'),
  401: errorResponse('Unauthorized'),
  403: errorResponse('Forbidden'),
  404: errorResponse('Not found'),
  409: errorResponse('Task is not filling a torrent'),
}

const registerRoute = authRoute(policy, {
  operationId: 'registerTaskTorrent',
  summary: "Register a torrent download's info dictionary",
  description:
    "Uploads the torrent's bencoded info dictionary. Its SHA-1 must equal the task's infoHash. The outcome says whether to upload the torrent's files, drop the task, or upload into the drive.",
  tags: ['Download Tasks'],
  method: 'put',
  path: '/{id}/torrent',
  request: { params: taskParams, ...jsonBody(registerTaskTorrentSchema) },
  responses: { 200: jsonContent(taskTorrentRegistrationSchema, 'Registration outcome'), ...errors },
})

const createFileUploadRoute = authRoute(policy, {
  operationId: 'createTorrentFileUpload',
  summary: 'Start uploading a torrent file',
  tags: ['Download Tasks'],
  method: 'post',
  path: '/{id}/torrent/files/{fileIdx}/uploads',
  request: { params: fileParams },
  responses: { 201: jsonContent(torrentFileUploadSchema, 'Presigned upload'), ...errors },
})

const abortFileUploadRoute = authRoute(policy, {
  operationId: 'abortTorrentFileUpload',
  summary: 'Abort a torrent file multipart upload',
  description: 'Abandons a multipart upload whose parts could not be uploaded, deleting the parts already stored.',
  tags: ['Download Tasks'],
  method: 'delete',
  path: '/{id}/torrent/files/{fileIdx}/uploads/{uploadId}',
  request: { params: fileParams.extend({ uploadId: z.string().min(1).max(1024) }) },
  responses: { 204: { description: 'Upload aborted' }, ...errors },
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

const completeRoute = authRoute(policy, {
  operationId: 'completeTaskTorrent',
  summary: 'Complete a torrent download',
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
  .openapi(abortFileUploadRoute, async (c) => {
    const { id, fileIdx, uploadId } = c.req.valid('param')
    await abortTorrentFileUpload(c.get('deps'), { ...uploader(c.get('principal'), id), fileIdx, uploadId })
    return c.body(null, 204)
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
