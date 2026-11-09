// TMDB scraping for media libraries. A scrape job takes the library's videos
// that need it (never scraped, changed since, or scraped in another language)
// a batch at a time, matches each to TMDB, records the result in media_scrapes,
// and writes Kodi/Jellyfin sidecars next to it. A file already at a sidecar
// path always wins: it is never replaced, and an existing .nfo with a TMDB id
// names the match instead of a search. library.json publishes only the TMDB
// ids, so a scrape that changes one queues a scan.

import { DirType, ObjectStatus } from '@shared/constants'
import type { MediaInfo, MediaLibraryScrapeJobRequest } from '@shared/schemas'
import { hasFeature } from '../domain/licensing'
import { joinMatterPath, libraryMediaInfo, VIDEO_EXTENSIONS } from '../domain/media-library'
import { episodeNfo, movieNfo, type NfoKind, readNfoIdentity, tvShowNfo } from '../domain/media-nfo'
import {
  episodeSidecars,
  type MediaScrapeResult,
  type MediaScrapeSource,
  MOVIE_FOLDER_NFO,
  mediaMatchKey,
  movieSidecars,
  reusableScrape,
  type SidecarPath,
  showFolderOf,
  showSidecars,
  sidecarKey,
} from '../domain/media-scrape'
import {
  chooseImage,
  chooseTmdbMatch,
  fanartPreference,
  normalizeTitle,
  posterPreference,
  TMDB_FALLBACK_LANGUAGE,
  type TmdbEpisode,
  type TmdbMediaType,
  type TmdbMovie,
  type TmdbSeason,
  type TmdbShow,
} from '../domain/tmdb'
import { formatError } from '../lib/errors'
import { buildObjectKey, fileExt } from '../lib/path-template'
import type { Deps } from './deps'
import { enqueueMediaLibraryScan, enqueueMediaLibraryScrape } from './media-library-jobs'
import {
  type ActorIdentity,
  type BackgroundJobMessage,
  type BackgroundJobRuntime,
  type Matter,
  type MediaLibraryScrapeCandidate,
  type MediaLibraryView,
  NameConflictError,
  StorageQuotaExceededError,
  type StorageRecord,
  TmdbAuthError,
  type TmdbConfig,
  type TmdbImageSize,
  TmdbRateLimitError,
  TmdbUnavailableError,
} from './ports'
import { loadBindingState } from './site/licensing'
import { withStorageUsageReservation } from './storage-usage'

// Videos per queue message. One video costs at most about 40 subrequests (the
// first episode of a show in the batch: two lookups, an .nfo read, up to four
// searches, show details and its English plot, a season and its English plots,
// four images, and six sidecar writes of three calls each), so a batch stays
// far below the Workers subrequest cap.
const SCRAPE_BATCH_SIZE = 20
// A TMDB Retry-After longer than this is shortened to it.
const MAX_RETRY_DELAY_SECONDS = 300
// 429s in a row without a finished video before the job fails.
const MAX_RATE_LIMITED_RETRIES = 10
// Only this much of an .nfo is read for its TMDB id.
const MAX_NFO_BYTES = 64 * 1024
const NFO_MIME = 'text/xml'
// Sidecars are machine-written, whoever asked for the scrape.
const SIDECAR_ACTOR: ActorIdentity = { type: 'system', ref: null, issuer: null }

export const TMDB_NOT_CONFIGURED_MESSAGE =
  'TMDB is not configured. An administrator can add a TMDB access token in the scraping settings.'

type ScrapeProgress = NonNullable<MediaLibraryScrapeJobRequest['resume']>
const INITIAL_PROGRESS: ScrapeProgress = {
  after: null,
  processed: 0,
  matched: 0,
  changed: 0,
  failed: 0,
  unavailable: 0,
  firstFailure: null,
  rateLimited: 0,
  quotaExceeded: false,
}
type ScrapeMessage = BackgroundJobMessage<MediaLibraryScrapeJobRequest>
type EpisodeInfo = Extract<MediaInfo, { type: 'episode' }>

// How a video's TMDB id was settled, before it becomes a movie or episode match.
type ResolvedId =
  | { status: 'matched'; source: MediaScrapeSource; id: number }
  | { status: 'unmatched'; source: MediaScrapeSource }

type SidecarFile = { bytes: Uint8Array; type: string }

// What one batch shares: TMDB lookups for the shows it meets and the folders it wrote to.
interface ScrapeSession {
  deps: Deps
  orgId: string
  userId: string
  library: MediaLibraryView
  config: TmdbConfig
  progress: ScrapeProgress
  storage: Promise<StorageRecord> | null
  shows: Map<string, Promise<ResolvedId>>
  showDetails: Map<string, Promise<TmdbShow | null>>
  seasons: Map<string, Promise<TmdbSeason | null>>
  writtenFolders: Set<string>
}

// Retrying cannot fix these: the library is gone, or TMDB is not configured.
class MediaLibraryScrapeStoppedError extends Error {}

// Runs when a scan completes. A scrape is queued only when TMDB is configured,
// the instance is entitled, no scrape holds the lease, and some video needs
// scraping, so the scan that follows a scrape finds nothing left and the loop ends.
export async function enqueueScrapeAfterScan(
  deps: Deps,
  message: BackgroundJobMessage,
  library: MediaLibraryView,
  runtime: BackgroundJobRuntime,
): Promise<void> {
  const config = await deps.tmdb.getConfig()
  if (!config) return
  if (!hasFeature('media_library', await loadBindingState(deps, runtime))) return
  const current = await liveLibrary(deps, library.orgId, library.id)
  if (!current || current.scraping) return
  const { orgId, folder } = current
  if (!(await deps.mediaLibraries.hasVideosToScrape(orgId, folder.path, VIDEO_EXTENSIONS, config.language))) return
  await enqueueMediaLibraryScrape(deps, { library: current, userId: message.userId, createdBy: message.createdBy })
}

// One batch per message. A full batch re-queues the job with its cursor; a 429
// re-queues it after TMDB's Retry-After. Either way the job's update renews the
// lease. Videos already recorded drop out of the needs-scraping predicate, so a
// redelivered message repeats no work.
export async function processMediaLibraryScrape(deps: Deps, message: ScrapeMessage): Promise<void> {
  const { orgId, jobId, request } = message
  const progress: ScrapeProgress = { ...(request.resume ?? INITIAL_PROGRESS) }
  const inFlight = { path: null as string | null }
  if (!request.resume) await deps.backgroundJobs.update(orgId, jobId, { status: 'running', startedAt: new Date() })
  try {
    const { library, done } = await scrapeBatch(deps, message, progress, inFlight)
    if (!done) {
      await renewLease(deps, message, progress)
      await deps.jobQueue.dispatch(continuation(message, progress))
      return
    }
    await finish(deps, message, progress)
    if (progress.changed > 0) {
      await rescanIndex(deps, message, library).catch((error: unknown) => {
        console.error(
          `media_library.scrape.scan_enqueue_error library=${library.id} org=${orgId} code=${formatError(error)}`,
        )
      })
    }
  } catch (error) {
    if (error instanceof TmdbRateLimitError && progress.rateLimited < MAX_RATE_LIMITED_RETRIES) {
      progress.rateLimited++
      await renewLease(deps, message, progress)
      const delaySeconds = Math.min(Math.max(error.retryAfterSeconds, 1), MAX_RETRY_DELAY_SECONDS)
      await deps.jobQueue.dispatch(continuation(message, progress), { delaySeconds })
      return
    }
    await deps.backgroundJobs.update(orgId, jobId, {
      status: 'failed',
      errorMessage: failureMessage(error),
      progress: { fileCount: videosDone(progress), currentFilename: inFlight.path },
      retryable: !(error instanceof MediaLibraryScrapeStoppedError || error instanceof TmdbAuthError),
      cancelable: false,
    })
  }
}

// A run where TMDB was unavailable for every video it tried fails, so the user
// sees the outage and can retry; any other run completes and reports what failed.
async function finish(deps: Deps, message: ScrapeMessage, progress: ScrapeProgress): Promise<void> {
  const { firstFailure } = progress
  if (firstFailure && progress.processed === 0 && progress.unavailable === progress.failed) {
    await deps.backgroundJobs.update(message.orgId, message.jobId, {
      status: 'failed',
      errorMessage: firstFailure.message,
      progress: { fileCount: videosDone(progress), currentFilename: firstFailure.path },
      retryable: true,
      cancelable: false,
    })
    return
  }
  await deps.backgroundJobs.update(message.orgId, message.jobId, {
    status: 'completed',
    progress: { fileCount: videosDone(progress), currentFilename: null },
    resultMetadata: {
      matched: progress.matched,
      unmatched: progress.processed - progress.matched,
      failed: progress.failed,
      firstFailed: firstFailure?.path ?? null,
      quotaExceeded: progress.quotaExceeded,
    },
    cancelable: false,
  })
}

async function scrapeBatch(
  deps: Deps,
  message: ScrapeMessage,
  progress: ScrapeProgress,
  inFlight: { path: string | null },
): Promise<{ library: MediaLibraryView; done: boolean }> {
  const library = await liveLibrary(deps, message.orgId, message.request.libraryId)
  if (!library) {
    throw new MediaLibraryScrapeStoppedError('Media library not found, or its folder is in trash or no longer exists')
  }
  const config = await deps.tmdb.getConfig()
  if (!config) throw new MediaLibraryScrapeStoppedError(TMDB_NOT_CONFIGURED_MESSAGE)
  const candidates = await deps.mediaLibraries.listVideosToScrape(
    message.orgId,
    library.folder.path,
    VIDEO_EXTENSIONS,
    config.language,
    { after: progress.after, limit: SCRAPE_BATCH_SIZE },
  )
  const session: ScrapeSession = {
    deps,
    orgId: message.orgId,
    userId: message.userId,
    library,
    config,
    progress,
    storage: null,
    shows: new Map(),
    showDetails: new Map(),
    seasons: new Map(),
    writtenFolders: new Set(),
  }
  try {
    for (const candidate of candidates) {
      inFlight.path = joinMatterPath(candidate.file.parent, candidate.file.name)
      await scrapeCandidate(session, candidate)
      progress.after = { parent: candidate.file.parent, name: candidate.file.name }
      progress.rateLimited = 0
    }
    inFlight.path = null
  } finally {
    if (session.writtenFolders.size > 0) {
      await deps.webdavPath.invalidateFolders(message.orgId, [...session.writtenFolders]).catch((error: unknown) => {
        console.error(`media_library.scrape.invalidate_error library=${library.id} code=${formatError(error)}`)
      })
    }
  }
  return { library, done: candidates.length < SCRAPE_BATCH_SIZE }
}

// A video that fails gets no record, so the next scrape tries it again, and
// the job moves on to the rest. Only a rejected token or a rate limit stops it.
async function scrapeCandidate(session: ScrapeSession, candidate: MediaLibraryScrapeCandidate): Promise<void> {
  const { progress } = session
  try {
    const { result, changed } = await scrapeVideo(session, candidate)
    progress.processed++
    if (result.status === 'matched') progress.matched++
    if (changed) progress.changed++
  } catch (error) {
    if (error instanceof TmdbAuthError || error instanceof TmdbRateLimitError) throw error
    const { file } = candidate
    console.error(
      `media_library.scrape.video_error library=${session.library.id} org=${session.orgId} matter=${file.id} code=${formatError(error)}`,
    )
    progress.failed++
    if (error instanceof TmdbUnavailableError) progress.unavailable++
    progress.firstFailure ??= { path: joinMatterPath(file.parent, file.name), message: failureMessage(error) }
  }
}

async function scrapeVideo(
  session: ScrapeSession,
  { file, previous }: MediaLibraryScrapeCandidate,
): Promise<{ result: MediaScrapeResult; changed: boolean }> {
  const { library, config } = session
  const media = libraryMediaInfo({ folderPath: library.folder.path, folderName: library.folder.name }, file)
  const matchKey = mediaMatchKey(media)
  const reusable = reusableScrape(previous, { matchKey, language: config.language })
  const result =
    media.type === 'episode'
      ? await scrapeEpisode(session, file, media, matchKey, reusable)
      : await scrapeMovie(session, file, media, reusable)
  await session.deps.mediaLibraries.recordScrape({
    matterId: file.id,
    orgId: session.orgId,
    libraryId: library.id,
    language: config.language,
    matchKey,
    fileUpdatedAt: file.updatedAt,
    result,
  })
  return { result, changed: publishedId(previous?.result) !== publishedId(result) }
}

// A file the parser could not classify has no title worth searching for, so
// only an .nfo matches it.
async function scrapeMovie(
  session: ScrapeSession,
  file: Matter,
  media: MediaInfo,
  reusable: MediaScrapeResult | null,
): Promise<MediaScrapeResult> {
  const sidecars = movieSidecars(file)
  const folderNfo = { parent: file.parent, name: MOVIE_FOLDER_NFO }
  const existing = await findExisting(session, [sidecars.nfo, sidecars.poster, sidecars.fanart, folderNfo])
  const nfoId = await nfoTmdbId(
    session,
    [existing.get(sidecarKey(sidecars.nfo)), existing.get(sidecarKey(folderNfo))],
    'movie',
  )
  const resolved: ResolvedId =
    nfoId !== null
      ? { status: 'matched', source: 'nfo', id: nfoId }
      : reusable
        ? resolvedFrom(reusable)
        : media.type === 'movie'
          ? await search(session, 'movie', media)
          : { status: 'unmatched', source: 'search' }
  if (resolved.status === 'unmatched') return resolved

  const result: MediaScrapeResult = {
    status: 'matched',
    source: resolved.source,
    match: { type: 'movie', id: resolved.id },
  }
  if ([sidecars.nfo, sidecars.poster, sidecars.fanart].every((path) => existing.has(sidecarKey(path)))) return result
  const movie = await movieDetails(session, resolved.id)
  if (!movie) return { status: 'unmatched', source: resolved.source }
  const { language } = session.config
  await writeSidecar(session, existing, sidecars.nfo, async () => nfoFile(movieNfo(movie)))
  await writeImage(
    session,
    existing,
    sidecars.poster,
    chooseImage(movie.posters, posterPreference(language)) ?? movie.posterPath,
    'w780',
  )
  await writeImage(
    session,
    existing,
    sidecars.fanart,
    chooseImage(movie.backdrops, fanartPreference(language)) ?? movie.backdropPath,
    'w1280',
  )
  return result
}

// Episodes of one show share one id lookup, one show fetch, and one fetch per
// season within the batch. A later batch finds the tvshow.nfo this one wrote.
async function scrapeEpisode(
  session: ScrapeSession,
  file: Matter,
  media: EpisodeInfo,
  matchKey: string,
  reusable: MediaScrapeResult | null,
): Promise<MediaScrapeResult> {
  const showFolder = showFolderOf(file.parent, session.library.folder.path, media.title)
  const episodeFiles = episodeSidecars(file)
  const showFiles = showFolder === null ? null : showSidecars(showFolder, media.season)
  const existing = await findExisting(session, [
    episodeFiles.nfo,
    episodeFiles.thumb,
    ...(showFiles ? [showFiles.nfo, showFiles.poster, showFiles.fanart, showFiles.seasonPoster] : []),
  ])
  const showKey = showFolder === null ? `title:${matchKey}` : `folder:${showFolder.toLowerCase()}`
  const resolved = await cached(session.shows, showKey, async (): Promise<ResolvedId> => {
    const nfoId = showFiles ? await nfoTmdbId(session, [existing.get(sidecarKey(showFiles.nfo))], 'tvshow') : null
    if (nfoId !== null) return { status: 'matched', source: 'nfo', id: nfoId }
    return reusable ? resolvedFrom(reusable) : search(session, 'tv', media)
  })
  if (resolved.status === 'unmatched') return resolved

  const result: MediaScrapeResult = {
    status: 'matched',
    source: resolved.source,
    match: { type: 'tv', id: resolved.id, season: media.season, episode: media.episode },
  }
  const missing = (path: SidecarPath) => !existing.has(sidecarKey(path))
  const { language } = session.config
  if (showFiles && [showFiles.nfo, showFiles.poster, showFiles.fanart].some(missing)) {
    const show = await showDetails(session, resolved.id)
    if (!show) return { status: 'unmatched', source: resolved.source }
    await writeSidecar(session, existing, showFiles.nfo, async () => nfoFile(tvShowNfo(show)))
    await writeImage(
      session,
      existing,
      showFiles.poster,
      chooseImage(show.posters, posterPreference(language)) ?? show.posterPath,
      'w780',
    )
    await writeImage(
      session,
      existing,
      showFiles.fanart,
      chooseImage(show.backdrops, fanartPreference(language)) ?? show.backdropPath,
      'w1280',
    )
  }
  if ([episodeFiles.nfo, episodeFiles.thumb, ...(showFiles ? [showFiles.seasonPoster] : [])].some(missing)) {
    const season = await seasonDetails(session, resolved.id, media.season, language)
    if (showFiles) await writeImage(session, existing, showFiles.seasonPoster, season?.posterPath ?? null, 'w780')
    const episode = season?.episodes.find((candidate) => candidate.episode === media.episode)
    if (episode) {
      await writeSidecar(session, existing, episodeFiles.nfo, async () =>
        nfoFile(episodeNfo(await withEpisodePlot(session, resolved.id, episode))),
      )
      await writeImage(session, existing, episodeFiles.thumb, episode.stillPath, 'w300')
    }
  }
  return result
}

// The parsed title is searched in the configured language and in English, with
// the parsed year and then without it, until a result matches. A search with no
// results at all ends that year: another language finds the same nothing.
async function search(
  session: ScrapeSession,
  kind: TmdbMediaType,
  media: { title: string; year?: number },
): Promise<ResolvedId> {
  if (!normalizeTitle(media.title)) return { status: 'unmatched', source: 'search' }
  const { tmdb } = session.deps
  const { accessToken, language } = session.config
  const languages = [...new Set([language, TMDB_FALLBACK_LANGUAGE])]
  const years = media.year === undefined ? [undefined] : [media.year, undefined]
  for (const year of years) {
    for (const searchLanguage of languages) {
      const query = { title: media.title, year }
      const hits =
        kind === 'movie'
          ? await tmdb.searchMovies(accessToken, query, searchLanguage)
          : await tmdb.searchShows(accessToken, query, searchLanguage)
      const best = chooseTmdbMatch(media, hits)
      if (best) return { status: 'matched', source: 'search', id: best.id }
      if (hits.length === 0) break
    }
  }
  return { status: 'unmatched', source: 'search' }
}

// The first of these .nfo files with a TMDB id names the match, unless its root
// says it describes something else (an episode's own .nfo carries the episode id).
async function nfoTmdbId(
  session: ScrapeSession,
  entries: ReadonlyArray<Matter | undefined>,
  kind: NfoKind,
): Promise<number | null> {
  for (const entry of entries) {
    if (!entry || entry.dirtype !== DirType.FILE || !entry.size) continue
    const storage = await session.deps.storages.get(entry.storageId)
    if (!storage) throw new Error(`Storage ${entry.storageId} of ${entry.name} not found`)
    const range = entry.size > MAX_NFO_BYTES ? `bytes=0-${MAX_NFO_BYTES - 1}` : undefined
    const identity = readNfoIdentity(
      new TextDecoder().decode(await session.deps.s3.getObjectBytes(storage, entry.object, range)),
    )
    if (identity.tmdbId !== null && (identity.kind === null || identity.kind === kind)) return identity.tmdbId
  }
  return null
}

async function movieDetails(session: ScrapeSession, id: number): Promise<TmdbMovie | null> {
  const { tmdb } = session.deps
  const { accessToken, language } = session.config
  const movie = await tmdb.getMovie(accessToken, id, language, { images: true })
  if (!movie || movie.overview || language === TMDB_FALLBACK_LANGUAGE) return movie
  const english = await tmdb.getMovie(accessToken, id, TMDB_FALLBACK_LANGUAGE, { images: false })
  return { ...movie, overview: english?.overview ?? '' }
}

function showDetails(session: ScrapeSession, id: number): Promise<TmdbShow | null> {
  return cached(session.showDetails, String(id), async () => {
    const { tmdb } = session.deps
    const { accessToken, language } = session.config
    const show = await tmdb.getShow(accessToken, id, language, { images: true })
    if (!show || show.overview || language === TMDB_FALLBACK_LANGUAGE) return show
    const english = await tmdb.getShow(accessToken, id, TMDB_FALLBACK_LANGUAGE, { images: false })
    return { ...show, overview: english?.overview ?? '' }
  })
}

function seasonDetails(session: ScrapeSession, showId: number, season: number, language: string) {
  return cached(session.seasons, `${showId}:${season}:${language}`, () =>
    session.deps.tmdb.getSeason(session.config.accessToken, showId, season, language),
  )
}

// An episode without a plot in the configured language takes the English one,
// fetched once per season.
async function withEpisodePlot(session: ScrapeSession, showId: number, episode: TmdbEpisode): Promise<TmdbEpisode> {
  if (episode.overview || session.config.language === TMDB_FALLBACK_LANGUAGE) return episode
  const english = await seasonDetails(session, showId, episode.season, TMDB_FALLBACK_LANGUAGE)
  const overview = english?.episodes.find((candidate) => candidate.episode === episode.episode)?.overview ?? ''
  return { ...episode, overview }
}

async function findExisting(session: ScrapeSession, paths: SidecarPath[]): Promise<Map<string, Matter>> {
  const entries = await session.deps.matter.findActiveAt(session.orgId, paths)
  return new Map(entries.map((entry) => [sidecarKey(entry), entry]))
}

// Writes the sidecar unless something already lives at its path. The create
// never replaces: an entry that appears between the lookup and the write wins,
// and the uploaded object is deleted. Once a write exceeds the quota, the job
// writes no more sidecars but still matches and records its videos.
async function writeSidecar(
  session: ScrapeSession,
  existing: ReadonlyMap<string, Matter>,
  path: SidecarPath,
  content: () => Promise<SidecarFile | null>,
): Promise<void> {
  if (session.progress.quotaExceeded || existing.has(sidecarKey(path))) return
  const file = await content()
  if (!file) return
  const { deps, orgId, userId } = session
  session.storage ??= deps.storages.select()
  const storage = await session.storage
  const size = file.bytes.byteLength
  const key = buildObjectKey({ uid: userId, orgId, rawExt: fileExt(path.name) })
  await deps.s3.putObject(storage, key, file.bytes, file.type, size)
  try {
    await withStorageUsageReservation(deps, { orgId, storageId: storage.id, bytes: size }, () =>
      deps.matter.create({
        orgId,
        name: path.name,
        type: file.type,
        size,
        dirtype: DirType.FILE,
        parent: path.parent,
        object: key,
        storageId: storage.id,
        status: ObjectStatus.ACTIVE,
        createdByActorType: SIDECAR_ACTOR.type,
        createdByActorRef: SIDECAR_ACTOR.ref,
        createdByActorIssuer: SIDECAR_ACTOR.issuer,
        onConflict: 'fail',
      }),
    )
  } catch (error) {
    await deps.s3.deleteObject(storage, key).catch((cleanupError: unknown) => {
      console.error(
        `media_library.scrape.sidecar_cleanup_error library=${session.library.id} org=${orgId} key=${key} code=${formatError(cleanupError)}`,
      )
    })
    if (error instanceof NameConflictError) return
    if (error instanceof StorageQuotaExceededError) {
      session.progress.quotaExceeded = true
      return
    }
    throw error
  }
  session.writtenFolders.add(path.parent)
}

function writeImage(
  session: ScrapeSession,
  existing: ReadonlyMap<string, Matter>,
  path: SidecarPath,
  imagePath: string | null,
  size: TmdbImageSize,
): Promise<void> {
  return writeSidecar(session, existing, path, async () => {
    if (!imagePath) return null
    const image = await session.deps.tmdb.getImage(imagePath, size)
    return image && { bytes: image.bytes, type: image.contentType }
  })
}

function nfoFile(text: string): SidecarFile {
  return { bytes: new TextEncoder().encode(text), type: NFO_MIME }
}

function resolvedFrom(result: MediaScrapeResult): ResolvedId {
  return result.status === 'matched' ? { status: 'matched', source: result.source, id: result.match.id } : result
}

function publishedId(result: MediaScrapeResult | undefined): string | null {
  return result?.status === 'matched' ? `${result.match.type}:${result.match.id}` : null
}

function cached<T>(cache: Map<string, Promise<T>>, key: string, load: () => Promise<T>): Promise<T> {
  let value = cache.get(key)
  if (!value) {
    value = load()
    cache.set(key, value)
  }
  return value
}

async function liveLibrary(
  deps: Pick<Deps, 'mediaLibraries'>,
  orgId: string,
  id: string,
): Promise<MediaLibraryView | null> {
  const library = await deps.mediaLibraries.get(orgId, id)
  return library?.folder && !library.folder.trashed ? { ...library, folder: library.folder } : null
}

// The scan that publishes the changed ids. A scan already holding the lease
// may have listed before them; the sweep rescans once the sidecars written
// here change the fingerprint.
async function rescanIndex(deps: Deps, message: ScrapeMessage, library: MediaLibraryView): Promise<void> {
  const current = await liveLibrary(deps, message.orgId, library.id)
  if (!current || current.scanning) return
  await enqueueMediaLibraryScan(deps, { library: current, userId: message.userId, createdBy: message.createdBy })
}

function renewLease(deps: Pick<Deps, 'backgroundJobs'>, message: ScrapeMessage, progress: ScrapeProgress) {
  return deps.backgroundJobs.update(message.orgId, message.jobId, {
    progress: { fileCount: videosDone(progress), currentFilename: null },
  })
}

function videosDone(progress: ScrapeProgress): number {
  return progress.processed + progress.failed
}

function continuation(message: ScrapeMessage, progress: ScrapeProgress): ScrapeMessage {
  return { ...message, request: { ...message.request, resume: { ...progress } } }
}

function failureMessage(error: unknown): string {
  if (error instanceof TmdbAuthError) {
    return 'TMDB rejected the access token. An administrator can update it in the scraping settings.'
  }
  if (error instanceof TmdbRateLimitError) {
    return `TMDB rate limited the scrape ${MAX_RATE_LIMITED_RETRIES} times in a row. Retry it later.`
  }
  return error instanceof Error ? error.message : String(error)
}
