import { eq } from 'drizzle-orm'
import type { Context, Next } from 'hono'
import type { Storage as S3Storage } from '../../shared/types'
import { imageHostingConfigs } from '../db/schema'
import type { Env } from '../middleware/platform'
import { PRESIGN_TTL_SECS, s3 } from '../routes/share-utils'
import { getImageByOrgPath, incrementAccessCount, resolveCustomDomain } from '../services/image-hosting'
import { getStorage } from '../services/storage'

const IMAGE_MAX_AGE = Math.min(PRESIGN_TTL_SECS - 30, 300)

function stripPort(host: string): string {
  const lastColon = host.lastIndexOf(':')
  if (lastColon < 0) return host
  const maybePort = host.slice(lastColon + 1)
  return /^\d+$/.test(maybePort) ? host.slice(0, lastColon) : host
}

function normalizeHost(raw: string): string | null {
  if (raw.includes('\0') || raw.includes('..')) return null
  return stripPort(raw.toLowerCase())
}

function getAppHostCandidates(c: Context<Env>): string[] {
  const candidates = ['workers.dev'] // *.workers.dev covers preview deployments
  const appHost = c.get('platform').getEnv('PUBLIC_APP_HOST')
  if (appHost) {
    const bare = appHost
      .replace(/^https?:\/\//, '')
      .split('/')[0]
      .toLowerCase()
    if (bare) candidates.push(bare)
  }
  return candidates
}

function checkReferer(refererAllowlist: string[], refererHeader: string | null): boolean {
  if (refererAllowlist.length === 0) return true
  if (!refererHeader) return false
  try {
    const origin = new URL(refererHeader).origin
    return refererAllowlist.includes(origin)
  } catch {
    return false
  }
}

async function handleImageByPath(c: Context<Env>, orgId: string, virtualPath: string): Promise<Response> {
  const db = c.get('platform').db

  const image = await getImageByOrgPath(db, orgId, virtualPath)
  if (!image) return c.json({ error: 'Not found' }, 404)

  const configRows = await db.select().from(imageHostingConfigs).where(eq(imageHostingConfigs.orgId, orgId)).limit(1)
  if (configRows.length === 0) return c.json({ error: 'Not found' }, 404)

  const config = configRows[0]
  const refererAllowlist = config.refererAllowlist ? (JSON.parse(config.refererAllowlist) as string[]) : []

  const refererHeader = c.req.header('Referer') ?? null
  if (!checkReferer(refererAllowlist, refererHeader)) {
    return c.json({ error: 'forbidden referer' }, 403)
  }

  const storage = (await getStorage(db, image.storageId)) as unknown as S3Storage
  if (!storage) return c.json({ error: 'Storage not found' }, 404)

  await incrementAccessCount(db, image.id)

  const url = await s3.presignInline(storage, image.storageKey, image.mime, PRESIGN_TTL_SECS)
  const res = c.redirect(url, 302)
  res.headers.set('Cache-Control', `public, max-age=${IMAGE_MAX_AGE}`)
  return res
}

// biome-ignore lint/suspicious/noConfusingVoidType: Next returns void; union with Response is intentional
export async function imageHostingDomain(c: Context<Env>, next: Next): Promise<Response | void> {
  const rawHost = c.req.header('host')
  if (!rawHost) return next()

  const host = normalizeHost(rawHost)
  if (!host) return next()

  const appHosts = getAppHostCandidates(c)
  if (appHosts.some((h) => host === h || host.endsWith(`.${h}`))) {
    return next()
  }

  const db = c.get('platform').db
  const orgId = await resolveCustomDomain(db, host)
  if (!orgId) return next()

  const virtualPath = c.req.path.replace(/^\/+/, '')
  if (!virtualPath) return c.json({ error: 'path required' }, 404)

  return handleImageByPath(c, orgId, virtualPath)
}
