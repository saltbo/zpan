// A workspace's Torrents list (docs/design/torrents.md §9): the entries, each
// torrent's own file tree, presigned play and download links, Remove, and Save
// to drive.

import { z } from '@hono/zod-openapi'
import { AuthorizationScope } from '@shared/authorization'
import { ZPAN_CLOUD_URL_DEFAULT } from '@shared/constants'
import {
  createWorkspaceTorrentTransferSchema,
  cursorPageQuerySchema,
  cursorPageSchema,
  opaqueIdSchema,
  type WorkspaceTorrent,
  type WorkspaceTorrentDetail,
  workspaceTorrentDetailSchema,
  workspaceTorrentFileLinkSchema,
  workspaceTorrentSchema,
  workspaceTorrentTransferSchema,
} from '@shared/schemas'
import type { Context } from 'hono'
import type { Env } from '../middleware/platform'
import { requireFeature } from '../middleware/require-feature'
import { notFound } from '../usecases/ports'
import {
  type WorkspaceTorrentDetail as DetailView,
  getWorkspaceTorrent,
  isPlayable,
  issueTorrentFileLink,
  listWorkspaceTorrents,
  removeWorkspaceTorrent,
  saveWorkspaceTorrentToDrive,
  type WorkspaceTorrentItem,
} from '../usecases/torrents/workspace-list'
import { authRoute, errorResponse, jsonBody, jsonContent } from './openapi'
import {
  createdAtIdCursorCodec,
  decodeOptionalPageToken,
  encodeNextPageToken,
  pageQueryFingerprint,
} from './page-token'
import { createRouter } from './router'

function toDTO(item: WorkspaceTorrentItem): WorkspaceTorrent {
  const { view, state } = item
  return {
    id: view.id,
    infoHash: view.torrent?.infoHash ?? view.infoHash,
    name: view.torrent?.name ?? view.displayName ?? view.infoHash ?? view.sourceUri,
    size: view.torrent?.totalSize ?? null,
    fileCount: view.torrent?.fileCount ?? null,
    status: state.status,
    error: state.error,
    pauseReason: state.pauseReason ?? null,
    source: view.source,
    sourceUri: view.sourceUri,
    playable: isPlayable(view, state),
    taskId: view.taskId,
    lastPlayedAt: view.lastPlayedAt?.toISOString() ?? null,
    createdAt: view.createdAt.toISOString(),
  }
}

function toDetailDTO(detail: DetailView): WorkspaceTorrentDetail {
  return {
    ...toDTO(detail),
    playable: detail.playable,
    files: detail.files.map((file) => ({
      id: file.id,
      index: file.fileIdx,
      path: file.path,
      size: file.size,
      mime: file.mime,
    })),
  }
}

function requireOrg(c: Context<Env>): string {
  const orgId = c.get('orgId')
  if (!orgId) throw notFound('No organization found')
  return orgId
}

const entryParams = z.object({ id: opaqueIdSchema })
const fileParams = z.object({ id: opaqueIdSchema, fileId: opaqueIdSchema })

const listRoute = authRoute(
  { scopes: [AuthorizationScope.WORKSPACE_TORRENTS_READ] },
  {
    operationId: 'listWorkspaceTorrents',
    summary: "List the workspace's torrents",
    tags: ['Workspace Torrents'],
    method: 'get',
    path: '/',
    middleware: [requireFeature('torrents')] as const,
    request: {
      query: cursorPageQuerySchema.extend({
        search: z.string().trim().max(200).optional().describe('Matches the name or the infoHash'),
      }),
    },
    responses: {
      200: jsonContent(cursorPageSchema(workspaceTorrentSchema, 'WorkspaceTorrentPage'), 'Entries, newest first'),
      400: errorResponse('Invalid page token'),
      402: errorResponse('Torrents require a Pro or Business license'),
    },
  },
)

const getRoute = authRoute(
  { scopes: [AuthorizationScope.WORKSPACE_TORRENTS_READ] },
  {
    operationId: 'getWorkspaceTorrent',
    summary: "Get a torrent of the workspace's list with its own file tree",
    tags: ['Workspace Torrents'],
    method: 'get',
    path: '/{id}',
    middleware: [requireFeature('torrents')] as const,
    request: { params: entryParams },
    responses: {
      200: jsonContent(workspaceTorrentDetailSchema, 'The entry and its files'),
      402: errorResponse('Torrents require a Pro or Business license'),
      404: errorResponse('Torrent not found'),
    },
  },
)

const linkRoute = authRoute(
  { scopes: [AuthorizationScope.WORKSPACE_TORRENTS_READ] },
  {
    operationId: 'createWorkspaceTorrentFileLink',
    summary: 'Get a playback and download link for a file of a torrent',
    description:
      "Returns a presigned URL valid for 12 hours, charged once per viewing against the workspace's traffic. Records the entry as played.",
    tags: ['Workspace Torrents'],
    method: 'post',
    path: '/{id}/files/{fileId}/links',
    middleware: [requireFeature('torrents')] as const,
    request: { params: fileParams },
    responses: {
      201: jsonContent(workspaceTorrentFileLinkSchema, 'Presigned link'),
      404: errorResponse('Torrent or file not found'),
      402: errorResponse('Torrents need a Pro or Business license, or there are not enough credits for the egress'),
      409: errorResponse('The torrent is not ready'),
      422: errorResponse('The traffic quota is used up'),
    },
  },
)

const deleteRoute = authRoute(
  { scopes: [AuthorizationScope.WORKSPACE_TORRENTS_DELETE], minTeamRole: 'editor' },
  {
    operationId: 'deleteWorkspaceTorrent',
    summary: "Remove a torrent from the workspace's list",
    description:
      'Removes the entry only. Drive files saved from it stay, and links already issued keep playing; only eviction deletes bytes.',
    tags: ['Workspace Torrents'],
    method: 'delete',
    path: '/{id}',
    middleware: [requireFeature('torrents')] as const,
    request: { params: entryParams },
    responses: {
      204: { description: 'Removed' },
      402: errorResponse('Torrents require a Pro or Business license'),
      404: errorResponse('Torrent not found'),
    },
  },
)

const transferRoute = authRoute(
  { scopes: [AuthorizationScope.WORKSPACE_TORRENTS_READ, AuthorizationScope.OBJECTS_CREATE], minTeamRole: 'editor' },
  {
    operationId: 'createWorkspaceTorrentTransfer',
    summary: 'Save a torrent to the drive',
    description:
      "Writes the torrent's files, sidecars and folders under the folder by instant transfer, without copying bytes. The workspace quota grows by their size.",
    tags: ['Workspace Torrents'],
    method: 'post',
    path: '/{id}/transfers',
    middleware: [requireFeature('torrents')] as const,
    request: { params: entryParams, ...jsonBody(createWorkspaceTorrentTransferSchema) },
    responses: {
      201: jsonContent(workspaceTorrentTransferSchema, 'The drive files written'),
      402: errorResponse('Torrents require a Pro or Business license'),
      404: errorResponse('Torrent not found'),
      409: errorResponse('The torrent is not ready, or a folder on the path is a file'),
      422: errorResponse('The files do not fit the workspace quota'),
    },
  },
)

export const workspaceTorrents = createRouter()
  .openapi(listRoute, async (c) => {
    const orgId = requireOrg(c)
    const { pageSize, pageToken, search } = c.req.valid('query')
    const page = {
      query: await pageQueryFingerprint({ resource: 'workspace-torrents', orgId, pageSize, search: search ?? null }),
      codec: createdAtIdCursorCodec,
    }
    const after = await decodeOptionalPageToken(c.get('platform'), pageToken, page)
    const result = await listWorkspaceTorrents(c.get('deps'), orgId, { pageSize, after, search: search || undefined })
    return c.json(
      {
        items: result.items.map(toDTO),
        nextPageToken: await encodeNextPageToken(c.get('platform'), result.nextBoundary, page),
      },
      200,
    )
  })
  .openapi(getRoute, async (c) => {
    const detail = await getWorkspaceTorrent(c.get('deps'), requireOrg(c), c.req.valid('param').id)
    return c.json(toDetailDTO(detail), 200)
  })
  .openapi(linkRoute, async (c) => {
    const { id, fileId } = c.req.valid('param')
    const userId = c.get('userId')
    if (!userId) throw notFound()
    const issued = await issueTorrentFileLink(c.get('deps'), {
      orgId: requireOrg(c),
      userId,
      actor: { actorType: 'user', actorRef: userId },
      entryId: id,
      fileId,
      cloudBaseUrl: c.get('platform').getEnv('ZPAN_CLOUD_URL') ?? ZPAN_CLOUD_URL_DEFAULT,
      source: 'torrents',
    })
    if ('error' in issued) throw issued.error
    return c.json({ url: issued.url, expiresAt: issued.expiresAt.toISOString() }, 201)
  })
  .openapi(deleteRoute, async (c) => {
    await removeWorkspaceTorrent(c.get('deps'), requireOrg(c), c.req.valid('param').id)
    return c.body(null, 204)
  })
  .openapi(transferRoute, async (c) => {
    const userId = c.get('userId')
    if (!userId) throw notFound()
    const files = await saveWorkspaceTorrentToDrive(c.get('deps'), {
      orgId: requireOrg(c),
      userId,
      id: c.req.valid('param').id,
      folder: c.req.valid('json').folder,
    })
    return c.json({ files: files.map((file) => ({ id: file.id, name: file.name, parent: file.parent })) }, 201)
  })
