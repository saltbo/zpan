import { createApp } from '../server/app'
import type { Auth } from '../server/auth'
import { createAuth } from '../server/auth'
import { createCloudflarePlatform } from '../server/platform/cloudflare'
import { resolveShareByToken } from '../server/services/share'
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

// Cache auth instance at isolate scope to avoid per-request DB queries
// for OIDC config loading. Changes to OIDC provider configs or env vars
// (BETTER_AUTH_URL, TRUSTED_ORIGINS) take effect on isolate recycle.
let cachedAuth: Auth | null = null

const SHARE_TOKEN_RE = /^\/s\/([^/?#]+)/

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const { BETTER_AUTH_SECRET } = env
    if (!BETTER_AUTH_SECRET) {
      throw new Error('BETTER_AUTH_SECRET is not configured for this deployment.')
    }
    const platform = createCloudflarePlatform(env)

    if (!cachedAuth) {
      const origin = new URL(request.url).origin
      const baseURL = env.BETTER_AUTH_URL || origin
      const trustedOrigins = env.TRUSTED_ORIGINS?.split(',')
        .map((o) => o.trim())
        .filter(Boolean) || [origin]
      cachedAuth = await createAuth(platform.db, BETTER_AUTH_SECRET, baseURL, trustedOrigins)
    }

    const url = new URL(request.url)
    const shareMatch = SHARE_TOKEN_RE.exec(url.pathname)

    if (shareMatch && request.method === 'GET') {
      return handleShareSsr(request, env, shareMatch[1], platform, cachedAuth)
    }

    return createApp(platform, cachedAuth).fetch(request)
  },

  async scheduled(_event: ScheduledEvent, env: Env): Promise<void> {
    await handleScheduled(env)
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
    return createApp(platform, auth).fetch(request)
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
