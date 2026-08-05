import { waitUntil } from 'cloudflare:workers'
import { createCloudflareKvBackend } from '../server/adapters/cache/cloudflare-kv'
import { createRuntimeCache, resolveCacheMode } from '../server/adapters/cache/runtime-cache'
import { createArchiveJobsGateway } from '../server/adapters/gateways/archive-jobs'
import { createShareRepo } from '../server/adapters/repos/share'
import { createApp } from '../server/app'
import type { Auth } from '../server/auth'
import { createAuth, officialWorkersPreviewOrigin } from '../server/auth'
import { createDeps } from '../server/composition'
import { isPotentialWebDavPublicRequest } from '../server/domain/webdav-public-url'
import { isHandledError, standaloneJsonError } from '../server/middleware/error-handler'
import { handleImageHostingDomainRequest } from '../server/middleware/image-hosting-domain'
import { createCloudflarePlatform } from '../server/platform/cloudflare'
import { platformContext } from '../server/platform/context'
import type { Deps } from '../server/usecases/deps'
import type { ArchiveJobMessage, CacheService } from '../server/usecases/ports'
import { DirType } from '../shared/constants'
import { handleScheduled } from './scheduled'

interface Env {
  DB: D1Database
  BETTER_AUTH_SECRET: string
  BETTER_AUTH_URL?: string
  TRUSTED_ORIGINS?: string
  ASSETS: Fetcher
  CACHE_KV?: KVNamespace
  [key: string]: unknown
}

const SHARE_TOKEN_RE = /^\/s\/([^/?#]+)/

// Cache auth instances at isolate scope to avoid per-request DB queries and
// better-auth init CPU. createAuth resolves $context before returning, so the
// cache never carries a pending promise tied to its creating request (which
// would hang every later auth call in the isolate). Fixed slots prevent a first
// request on the WebDAV hostname from fixing the primary app base URL without
// allowing arbitrary Host headers to grow the cache. Changes to OAuth provider
// configs or env vars take effect on isolate recycle.
type AuthSlot = 'configured' | 'primary' | 'webdav' | `preview:${string}`

export function resolveAuthBaseURL(configuredBaseURL: string | undefined, requestOrigin: string): string {
  return officialWorkersPreviewOrigin(configuredBaseURL, requestOrigin) || configuredBaseURL || requestOrigin
}

interface WorkerRuntime {
  platform: ReturnType<typeof createCloudflarePlatform>
  deps: Deps
  cache: CacheService
  authBySlot: Map<AuthSlot, Auth>
  appBySlot: Map<AuthSlot, ReturnType<typeof createApp>>
  appInitBySlot: Map<AuthSlot, Promise<ReturnType<typeof createApp>>>
}

let cachedRuntime: WorkerRuntime | undefined
const responseCache = (
  caches as unknown as {
    default: {
      match(request: Request): Promise<Response | undefined>
      put(request: Request, response: Response): Promise<void>
    }
  }
).default

function runtimeFor(env: Env): WorkerRuntime {
  if (cachedRuntime) return cachedRuntime

  const platform = createCloudflarePlatform(env)
  const distributed = env.CACHE_KV ? createCloudflareKvBackend(env.CACHE_KV) : undefined
  const cache = createRuntimeCache({
    mode: resolveCacheMode(env.ZPAN_CACHE_MODE as string | undefined, !!distributed),
    distributed,
  })
  cachedRuntime = {
    platform,
    cache,
    deps: createDeps(platform, { cache }),
    authBySlot: new Map(),
    appBySlot: new Map(),
    appInitBySlot: new Map(),
  }
  return cachedRuntime
}

async function appForRequest(
  runtime: WorkerRuntime,
  request: Request,
  env: Env,
): Promise<ReturnType<typeof createApp>> {
  const origin = new URL(request.url).origin
  const webDavRequest = isPotentialWebDavPublicRequest(request.url)
  const previewOrigin = officialWorkersPreviewOrigin(env.BETTER_AUTH_URL, origin)
  const baseURL = resolveAuthBaseURL(env.BETTER_AUTH_URL, origin)
  const trustedOrigins = env.TRUSTED_ORIGINS?.split(',')
    .map((value) => value.trim())
    .filter(Boolean) || [origin]
  const slot: AuthSlot = previewOrigin
    ? `preview:${previewOrigin}`
    : env.BETTER_AUTH_URL
      ? 'configured'
      : webDavRequest
        ? 'webdav'
        : 'primary'

  const cachedApp = runtime.appBySlot.get(slot)
  const cachedAuth = runtime.authBySlot.get(slot)
  if (cachedApp && cachedAuth) return cachedApp

  const pendingApp = runtime.appInitBySlot.get(slot)
  if (pendingApp) return pendingApp

  const appPromise = createAuth(runtime.platform, env.BETTER_AUTH_SECRET, baseURL, trustedOrigins, waitUntil).then(
    (auth) => {
      const app = createApp(runtime.platform, auth, runtime.deps)
      runtime.authBySlot.set(slot, auth)
      runtime.appBySlot.set(slot, app)
      return app
    },
  )
  runtime.appInitBySlot.set(slot, appPromise)
  try {
    return await appPromise
  } finally {
    runtime.appInitBySlot.delete(slot)
  }
}

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const { BETTER_AUTH_SECRET } = env
    if (!BETTER_AUTH_SECRET) {
      throw new Error('BETTER_AUTH_SECRET is not configured for this deployment.')
    }
    const runtime = runtimeFor(env)
    const imageDomainResponse = await handleImageDomainBeforeAuth(request, env, runtime)
    if (imageDomainResponse) return imageDomainResponse
    const edgeCached = await matchConfigzResponseCache(request, runtime.cache)
    if (edgeCached) return edgeCached
    const app = await appForRequest(runtime, request, env)

    return platformContext.run(runtime.platform, async () => {
      const url = new URL(request.url)
      const shareMatch = SHARE_TOKEN_RE.exec(url.pathname)

      if (shareMatch && request.method === 'GET') {
        return handleShareSsr(request, env, ctx, shareMatch[1], runtime.platform, app)
      }

      const response = await app.fetch(request, env, ctx)
      cacheConfigzResponse(request, response, runtime.cache, ctx)
      return response
    })
  },

  async scheduled(event: ScheduledEvent, env: Env): Promise<void> {
    await handleScheduled(event, env)
  },

  async queue(batch: MessageBatch<ArchiveJobMessage>, env: Env): Promise<void> {
    const runtime = runtimeFor(env)
    const archiveJobs = createArchiveJobsGateway(runtime.platform)
    for (const message of batch.messages) {
      await archiveJobs.runMessage(message.body)
      message.ack()
    }
  },
}

async function handleImageDomainBeforeAuth(
  request: Request,
  env: Env,
  runtime: WorkerRuntime,
): Promise<Response | null> {
  if (!isImageDomainFastPathRequest(request, env)) return null

  try {
    return await platformContext.run(runtime.platform, () =>
      handleImageHostingDomainRequest({
        request,
        deps: runtime.deps,
        platform: runtime.platform,
        appHosts: [new URL(env.BETTER_AUTH_URL!).hostname.toLowerCase(), 'workers.dev'],
        webDavMountPath: '/dav',
      }),
    )
  } catch (error) {
    if (!isHandledError(error)) console.error(`image_domain.unhandled_error code=${String(error)}`)
    return standaloneJsonError(error)
  }
}

export function isImageDomainFastPathRequest(request: Request, env: Pick<Env, 'BETTER_AUTH_URL'>): boolean {
  if (!env.BETTER_AUTH_URL) return false
  const url = new URL(request.url)
  if (url.pathname !== '/ih' && !url.pathname.startsWith('/ih/')) return false

  const host = (request.headers.get('host') ?? url.host).replace(/:\d+$/, '').toLowerCase()
  const appHost = new URL(env.BETTER_AUTH_URL).hostname.toLowerCase()
  return host !== appHost && !host.endsWith('.workers.dev')
}

function configzCacheKey(request: Request, includeValidators = false): Request | null {
  if (request.method !== 'GET') return null
  const url = new URL(request.url)
  if (url.pathname !== '/api/configz' && url.pathname !== '/api/configz/') return null
  url.search = ''
  const ifNoneMatch = request.headers.get('If-None-Match')
  return new Request(url.toString(), {
    method: 'GET',
    headers: includeValidators && ifNoneMatch ? { 'If-None-Match': ifNoneMatch } : undefined,
  })
}

async function matchConfigzResponseCache(request: Request, cache: CacheService): Promise<Response | null> {
  if (cache.mode !== 'distributed') return null
  const key = configzCacheKey(request, true)
  if (!key) return null
  try {
    const matched = await responseCache.match(key)
    if (!matched) return null
    const response = new Response(matched.body, matched)
    response.headers.set('X-ZPan-Cache', 'edge')
    return response
  } catch (error) {
    console.error(
      JSON.stringify({
        message: 'cache.response.get.error',
        error: error instanceof Error ? error.message : String(error),
      }),
    )
    return null
  }
}

function cacheConfigzResponse(request: Request, response: Response, cache: CacheService, ctx: ExecutionContext): void {
  if (cache.mode !== 'distributed' || response.status !== 200) return
  const key = configzCacheKey(request)
  if (!key) return
  const task = responseCache.put(key, response.clone()).catch((error: unknown) => {
    console.error(
      JSON.stringify({
        message: 'cache.response.put.error',
        error: error instanceof Error ? error.message : String(error),
      }),
    )
  })
  ctx.waitUntil(task)
}

interface ShareMeta {
  title: string
  description: string
  imageUrl: string
}

async function fetchShareMeta(
  platform: ReturnType<typeof createCloudflarePlatform>,
  origin: string,
  token: string,
): Promise<ShareMeta> {
  const fallback: ShareMeta = {
    title: 'Share unavailable',
    description: 'Shared via ZPan',
    imageUrl: `${origin}/logo-512.png`,
  }

  try {
    const resolved = await createShareRepo(platform.db).resolveByToken(token)
    if (resolved.status !== 'ok') return fallback
    if (resolved.share.kind !== 'landing') return fallback

    const { share, matter } = resolved
    const expiry = share.expiresAt ? ` · Expires ${new Date(share.expiresAt).toLocaleDateString()}` : ''
    const description = `Shared via ZPan${expiry}`
    const isImage = matter.type.startsWith('image/') && matter.dirtype === DirType.FILE

    return {
      title: matter.name,
      description,
      imageUrl: isImage ? `${origin}/api/share/${token}/download` : `${origin}/logo-512.png`,
    }
  } catch {
    return fallback
  }
}

function escapeAttr(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/"/g, '&quot;')
}

function buildOgTags(meta: ShareMeta, pageUrl: string): string {
  return [
    `<meta property="og:title" content="${escapeAttr(meta.title)}" />`,
    `<meta property="og:description" content="${escapeAttr(meta.description)}" />`,
    `<meta property="og:image" content="${escapeAttr(meta.imageUrl)}" />`,
    `<meta property="og:type" content="website" />`,
    `<meta property="og:url" content="${escapeAttr(pageUrl)}" />`,
    `<meta name="twitter:card" content="summary_large_image" />`,
    `<meta name="twitter:title" content="${escapeAttr(meta.title)}" />`,
    `<meta name="twitter:description" content="${escapeAttr(meta.description)}" />`,
    `<meta name="twitter:image" content="${escapeAttr(meta.imageUrl)}" />`,
  ].join('\n    ')
}

async function handleShareSsr(
  request: Request,
  env: Env,
  ctx: ExecutionContext,
  token: string,
  platform: ReturnType<typeof createCloudflarePlatform>,
  app: ReturnType<typeof createApp>,
): Promise<Response> {
  const url = new URL(request.url)
  const origin = url.origin

  const [meta, spaRes] = await Promise.all([
    fetchShareMeta(platform, origin, token),
    env.ASSETS.fetch(new Request(`${origin}/index.html`, { headers: request.headers })),
  ])

  if (!spaRes.ok) {
    return app.fetch(request, env, ctx)
  }

  const html = await spaRes.text()
  const ogTags = buildOgTags(meta, url.href)
  const injected = html.replace(
    '<title>ZPan</title>',
    `<title>${meta.title.replace(/</g, '&lt;')} — ZPan</title>\n    ${ogTags}`,
  )

  return new Response(injected, {
    status: 200,
    headers: {
      'Content-Type': 'text/html; charset=UTF-8',
      'Cache-Control': 'no-store',
    },
  })
}
