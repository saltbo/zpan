import { createArchiveJobsGateway } from '../server/adapters/gateways/archive-jobs'
import { createApp } from '../server/app'
import type { Auth } from '../server/auth'
import { createAuth } from '../server/auth'
import { createCloudflarePlatform } from '../server/platform/cloudflare'
import { platformContext } from '../server/platform/context'
import { resolveShareByToken } from '../server/services/share'
import type { ArchiveJobMessage } from '../server/usecases/ports'
import { DirType } from '../shared/constants'
import { handleScheduled } from './scheduled'

interface Env {
  DB: D1Database
  BETTER_AUTH_SECRET: string
  BETTER_AUTH_URL?: string
  TRUSTED_ORIGINS?: string
  ASSETS: Fetcher
  [key: string]: unknown
}

const SHARE_TOKEN_RE = /^\/s\/([^/?#]+)/

// Cache auth instance at isolate scope to avoid per-request DB queries and
// better-auth init CPU. createAuth resolves $context before returning, so the
// cached instance never carries a pending promise tied to its creating request
// (which would hang every later auth call in the isolate). Changes to OAuth
// provider configs or env vars (BETTER_AUTH_URL, TRUSTED_ORIGINS) take effect
// on isolate recycle.
let cachedAuth: Auth | null = null

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const { BETTER_AUTH_SECRET } = env
    if (!BETTER_AUTH_SECRET) {
      throw new Error('BETTER_AUTH_SECRET is not configured for this deployment.')
    }
    const platform = createCloudflarePlatform(env)
    const origin = new URL(request.url).origin
    const baseURL = env.BETTER_AUTH_URL || origin
    const trustedOrigins = env.TRUSTED_ORIGINS?.split(',')
      .map((o) => o.trim())
      .filter(Boolean) || [origin]

    if (!cachedAuth) {
      cachedAuth = await createAuth(platform, BETTER_AUTH_SECRET, baseURL, trustedOrigins)
    }

    return platformContext.run(platform, async () => {
      const url = new URL(request.url)
      const shareMatch = SHARE_TOKEN_RE.exec(url.pathname)

      if (shareMatch && request.method === 'GET') {
        return handleShareSsr(request, env, ctx, shareMatch[1], platform, cachedAuth!)
      }

      return createApp(platform, cachedAuth!).fetch(request, env, ctx)
    })
  },

  async scheduled(event: ScheduledEvent, env: Env): Promise<void> {
    await handleScheduled(event, env)
  },

  async queue(batch: MessageBatch<ArchiveJobMessage>, env: Env): Promise<void> {
    const platform = createCloudflarePlatform(env)
    const archiveJobs = createArchiveJobsGateway(platform)
    for (const message of batch.messages) {
      await archiveJobs.runMessage(message.body)
      message.ack()
    }
  },
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
    const resolved = await resolveShareByToken(platform.db, token)
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
  auth: Auth,
): Promise<Response> {
  const url = new URL(request.url)
  const origin = url.origin

  const [meta, spaRes] = await Promise.all([
    fetchShareMeta(platform, origin, token),
    env.ASSETS.fetch(new Request(`${origin}/index.html`, { headers: request.headers })),
  ])

  if (!spaRes.ok) {
    return createApp(platform, auth).fetch(request, env, ctx)
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
