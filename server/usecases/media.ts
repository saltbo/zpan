// Scraped media: the `media` file metadata a downloader writes on the matters a
// task uploaded, and the Movies and TV Shows views that read it back. The server never
// calls TMDB; it validates what the downloader sends and serves it.

import { DirType } from '@shared/constants'
import type { EpisodeMediaMetadata, MediaMetadata, MovieMediaMetadata, TvShowMediaMetadata } from '@shared/schemas'
import { joinMatterPath } from '../domain/media-library'
import type { Deps } from './deps'
import { assertTaskUploadAllowed } from './downloads/downloads'
import { isWithinDownloadTarget } from './object'
import {
  badRequest,
  conflict,
  type EpisodePageBoundary,
  forbidden,
  type Matter,
  type MediaPageBoundary,
  notFound,
} from './ports'
import { confirmDownloadTraffic, meterDownloadTraffic, reverseDownloadTraffic } from './store/traffic-metering'
import { createTrafficEventId } from './transfer-activity'

const IMAGE_URL_TTL_SECONDS = 15 * 60

export interface TaskUploadWriter {
  taskId: string
  downloaderId: string
  targetFolder: string
}

// A task's upload token may set `media` on what that task uploaded: a live
// matter inside the task's target folder that records the task as its creator.
// A matter from before matters recorded their task counts as the task's when
// the task's downloader created it since the task's current assignment. A folder it did not create (a show
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
  // A show is a folder; a movie or an episode is a video.
  if ((media.kind === 'tvshow') !== (matter.dirtype !== DirType.FILE)) {
    throw badRequest(media.kind === 'tvshow' ? 'Show media belongs on a folder' : 'Video media belongs on a file')
  }
  if (createdByTask(matter, writer, task.assignedAt)) {
    if (!(await deps.matter.setMediaMetadata(orgId, objectId, media, { onlyIfAbsent: false }))) throw notFound()
    return
  }
  if (matter.dirtype === DirType.FILE) throw forbidden('Object is outside task authorization')
  if (!(await deps.matter.setMediaMetadata(orgId, objectId, media, { onlyIfAbsent: true }))) {
    throw conflict('Folder already has media metadata', 'MEDIA_METADATA_EXISTS')
  }
}

function createdByTask(matter: Matter, writer: TaskUploadWriter, assignedAt: Date | null): boolean {
  if (matter.createdByTaskId) return matter.createdByTaskId === writer.taskId
  return (
    matter.createdByActorType === 'device' &&
    matter.createdByActorRef === writer.downloaderId &&
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

export interface ShowItem {
  matter: Matter
  media: TvShowMediaMetadata
  posterUrl: string | null
}

export interface EpisodeItem {
  matter: Matter
  media: EpisodeMediaMetadata
  stillUrl: string | null
}

type ImageDeps = Pick<Deps, 'storages' | 's3' | 'quota' | 'licenseBinding' | 'licensingCloud' | 'cloudTrafficReports'>
type ImageParams = { orgId: string; cloudBaseUrl: string }

// The workspace's scraped movies, newest first. Each poster that resolves to a
// live image gets a short-lived inline URL, metered as a download; a poster
// that is gone, or whose download the workspace's traffic does not allow, is
// left out and the card shows the title instead.
export async function listMovies(
  deps: Pick<Deps, 'matter'> & ImageDeps,
  params: ImageParams & { pageSize: number; after?: MediaPageBoundary },
): Promise<{ items: MovieItem[]; nextBoundary: MediaPageBoundary | null }> {
  const page = await deps.matter.listMediaPage(params.orgId, {
    kind: 'movie',
    pageSize: params.pageSize,
    after: params.after,
  })
  const movies = page.items.flatMap((matter) =>
    matter.metadata?.media?.kind === 'movie' && matter.dirtype === DirType.FILE
      ? [{ matter, media: matter.metadata.media }]
      : [],
  )
  const urls = await imageUrls(
    deps,
    params,
    movies.map(({ media }) => media.poster),
  )
  return {
    items: movies.map((movie, i) => ({ ...movie, posterUrl: urls[i] })),
    nextBoundary: page.nextBoundary,
  }
}

// The workspace's scraped shows, the folders carrying show media, newest
// first, with poster URLs as for movies.
export async function listShows(
  deps: Pick<Deps, 'matter'> & ImageDeps,
  params: ImageParams & { pageSize: number; after?: MediaPageBoundary },
): Promise<{ items: ShowItem[]; nextBoundary: MediaPageBoundary | null }> {
  const page = await deps.matter.listMediaPage(params.orgId, {
    kind: 'tvshow',
    pageSize: params.pageSize,
    after: params.after,
  })
  const shows = page.items.flatMap((matter) =>
    matter.metadata?.media?.kind === 'tvshow' && matter.dirtype !== DirType.FILE
      ? [{ matter, media: matter.metadata.media }]
      : [],
  )
  const urls = await imageUrls(
    deps,
    params,
    shows.map(({ media }) => media.poster),
  )
  return {
    items: shows.map((show, i) => ({ ...show, posterUrl: urls[i] })),
    nextBoundary: page.nextBoundary,
  }
}

async function liveShow(deps: Pick<Deps, 'matter'>, orgId: string, showId: string) {
  const show = await deps.matter.get(showId, orgId)
  const media = show?.metadata?.media
  if (
    !show ||
    show.trashedAt !== null ||
    show.status !== 'active' ||
    show.dirtype === DirType.FILE ||
    media?.kind !== 'tvshow'
  ) {
    throw notFound('Show not found')
  }
  return { matter: show, media }
}

// One scraped show by its folder id, with its poster URL.
export async function getShow(
  deps: Pick<Deps, 'matter'> & ImageDeps,
  params: ImageParams & { showId: string },
): Promise<ShowItem> {
  const show = await liveShow(deps, params.orgId, params.showId)
  const [posterUrl] = await imageUrls(deps, params, [show.media.poster])
  return { ...show, posterUrl }
}

// The episodes anywhere under a show folder, by season and episode, each with
// a still URL as posters get. A folder that is not a live show is not found.
export async function listShowEpisodes(
  deps: Pick<Deps, 'matter'> & ImageDeps,
  params: ImageParams & { showId: string; pageSize: number; after?: EpisodePageBoundary },
): Promise<{ items: EpisodeItem[]; nextBoundary: EpisodePageBoundary | null }> {
  const { matter: show } = await liveShow(deps, params.orgId, params.showId)
  const page = await deps.matter.listEpisodePage(params.orgId, {
    folderPath: joinMatterPath(show.parent, show.name),
    pageSize: params.pageSize,
    after: params.after,
  })
  const episodes = page.items.flatMap((matter) =>
    matter.metadata?.media?.kind === 'episode' ? [{ matter, media: matter.metadata.media }] : [],
  )
  const urls = await imageUrls(
    deps,
    params,
    episodes.map(({ media }) => media.still),
  )
  return {
    items: episodes.map((episode, i) => ({ ...episode, stillUrl: urls[i] })),
    nextBoundary: page.nextBoundary,
  }
}

// One URL per image id, null where the id is absent or does not resolve.
async function imageUrls(
  deps: Pick<Deps, 'matter'> & ImageDeps,
  params: ImageParams,
  imageIds: (string | undefined)[],
): Promise<(string | null)[]> {
  const ids = imageIds.filter((id): id is string => Boolean(id))
  const images = new Map((await deps.matter.getMany(params.orgId, ids)).map((image) => [image.id, image]))
  const urls: (string | null)[] = []
  for (const id of imageIds) {
    const image = id ? images.get(id) : undefined
    urls.push(image ? await imageUrl(deps, params, image) : null)
  }
  return urls
}

async function imageUrl(deps: ImageDeps, params: ImageParams, image: Matter): Promise<string | null> {
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
