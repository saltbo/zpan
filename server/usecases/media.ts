// Scraped media: the `media` file metadata a downloader writes on the matters a
// task uploaded, and the Movies view that reads it back. The server never
// calls TMDB; it validates what the downloader sends and serves it.

import { DirType } from '@shared/constants'
import type { MediaMetadata, MovieMediaMetadata } from '@shared/schemas'
import type { Deps } from './deps'
import { assertTaskUploadAllowed } from './downloads/downloads'
import { isWithinDownloadTarget } from './object'
import { conflict, forbidden, type Matter, type MediaPageBoundary, notFound } from './ports'
import { confirmDownloadTraffic, meterDownloadTraffic, reverseDownloadTraffic } from './store/traffic-metering'
import { createTrafficEventId } from './transfer-activity'

const IMAGE_URL_TTL_SECONDS = 15 * 60

export interface TaskUploadWriter {
  taskId: string
  downloaderId: string
  targetFolder: string
}

// A task's upload token may set `media` on what that task uploaded: a live
// matter inside the task's target folder, created by the task's downloader
// since the task's current assignment. A folder it did not create (a show
// folder an earlier task made) takes `media` only while it has none, so an
// earlier task's show data is never overwritten.
export async function setTaskMediaMetadata(
  deps: Pick<Deps, 'matter' | 'downloaders' | 'downloadTasks'>,
  params: { orgId: string; objectId: string; writer: TaskUploadWriter; media: MediaMetadata },
): Promise<void> {
  const { orgId, objectId, writer, media } = params
  const task = await assertTaskUploadAllowed(deps as Deps, {
    taskId: writer.taskId,
    downloaderId: writer.downloaderId,
  })
  const matter = await deps.matter.get(objectId, orgId)
  if (!matter || matter.trashedAt !== null || matter.status !== 'active') throw notFound()
  if (!isWithinDownloadTarget(matter.parent, writer.targetFolder)) {
    throw forbidden('Object is outside task authorization')
  }
  if (createdByTask(matter, writer.downloaderId, task.assignedAt)) {
    if (!(await deps.matter.setMediaMetadata(orgId, objectId, media, { onlyIfAbsent: false }))) throw notFound()
    return
  }
  if (matter.dirtype === DirType.FILE) throw forbidden('Object is outside task authorization')
  if (!(await deps.matter.setMediaMetadata(orgId, objectId, media, { onlyIfAbsent: true }))) {
    throw conflict('Folder already has media metadata', 'MEDIA_METADATA_EXISTS')
  }
}

function createdByTask(matter: Matter, downloaderId: string, assignedAt: Date | null): boolean {
  return (
    matter.createdByActorType === 'device' &&
    matter.createdByActorRef === downloaderId &&
    assignedAt !== null &&
    // createdAt has second precision.
    matter.createdAt.getTime() >= Math.floor(assignedAt.getTime() / 1000) * 1000
  )
}

export interface MovieItem {
  matter: Matter
  media: MovieMediaMetadata
  posterUrl: string | null
}

// The workspace's scraped movies, newest first. Each poster that resolves to a
// live image gets a short-lived inline URL, metered as a download; a poster
// that is gone, or whose download the workspace's traffic does not allow, is
// left out and the card shows the title instead.
export async function listMovies(
  deps: Pick<
    Deps,
    'matter' | 'storages' | 's3' | 'quota' | 'licenseBinding' | 'licensingCloud' | 'cloudTrafficReports'
  >,
  params: { orgId: string; pageSize: number; after?: MediaPageBoundary; cloudBaseUrl: string },
): Promise<{ items: MovieItem[]; nextBoundary: MediaPageBoundary | null }> {
  const page = await deps.matter.listMediaPage(params.orgId, {
    kind: 'movie',
    pageSize: params.pageSize,
    after: params.after,
  })
  const movies = page.items.flatMap((matter) =>
    matter.metadata?.media?.kind === 'movie' ? [{ matter, media: matter.metadata.media }] : [],
  )
  const posterIds = movies.flatMap(({ media }) => (media.poster ? [media.poster] : []))
  const posters = new Map((await deps.matter.getMany(params.orgId, posterIds)).map((poster) => [poster.id, poster]))
  const items: MovieItem[] = []
  for (const movie of movies) {
    const poster = movie.media.poster ? posters.get(movie.media.poster) : undefined
    items.push({ ...movie, posterUrl: poster ? await imageUrl(deps, params, poster) : null })
  }
  return { items, nextBoundary: page.nextBoundary }
}

async function imageUrl(
  deps: Pick<Deps, 'storages' | 's3' | 'quota' | 'licenseBinding' | 'licensingCloud' | 'cloudTrafficReports'>,
  params: { orgId: string; cloudBaseUrl: string },
  image: Matter,
): Promise<string | null> {
  if (image.trashedAt !== null || image.status !== 'active' || image.dirtype !== DirType.FILE || !image.object) {
    return null
  }
  const storage = await deps.storages.get(image.storageId)
  if (!storage) return null
  const bytes = image.size ?? 0
  const eventId = createTrafficEventId()
  const metered = await meterDownloadTraffic(deps, {
    cloudBaseUrl: params.cloudBaseUrl,
    orgId: params.orgId,
    bytes,
    storage,
    source: 'object_download',
    sourceId: image.id,
    eventId,
  })
  if (!metered.ok) return null
  try {
    const url = await deps.s3.presignInline(storage, image.object, image.type || 'image/jpeg', IMAGE_URL_TTL_SECONDS)
    await confirmDownloadTraffic(deps, { eventId })
    return url
  } catch (error) {
    await reverseDownloadTraffic(deps, { orgId: params.orgId, bytes, eventId })
    throw error
  }
}
