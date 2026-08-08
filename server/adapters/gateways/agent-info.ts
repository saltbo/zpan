import { z } from 'zod'
import {
  type AgentInfoGateway,
  type AuditActorIdentity,
  type AuditActorProfile,
  auditActorIdentityKey,
} from '../../usecases/ports'

const DISCOVERY_TTL_MS = 5 * 60 * 1000
const PROFILE_TTL_MS = 5 * 60 * 1000
const REQUEST_TIMEOUT_MS = 3_000
const MAX_CACHE_ENTRIES = 500
const MAX_CONCURRENT_REQUESTS = 8

const discoverySchema = z.object({
  issuer: z.string().url(),
  agent_profile_uri_template: z.string().min(1),
})

const agentProfileSchema = z.object({
  type: z.literal('agent'),
  view: z.literal('summary'),
  issuer: z.string().url(),
  subject: z.string().min(1),
  name: z.string().min(1),
  picture: z.union([z.string().url(), z.string().regex(/^\/api\/assets\/[A-Za-z0-9_-]+$/)]),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
})

type CacheEntry<T> = { value: T; expiresAt: number }

export function createAgentInfoGateway(request: typeof fetch = fetch): AgentInfoGateway {
  const discoveryCache = new Map<string, CacheEntry<string>>()
  const discoveryInflight = new Map<string, Promise<string | null>>()
  const profileCache = new Map<string, CacheEntry<AuditActorProfile>>()

  return {
    async resolve(actors, trustedIssuerOrigins) {
      const profiles = new Map<string, AuditActorProfile>()
      const uniqueActors = uniqueAgentActors(actors)
      await inBatches(uniqueActors, MAX_CONCURRENT_REQUESTS, async (actor) => {
        const issuer = trustedIssuer(actor.issuer, trustedIssuerOrigins)
        if (!issuer || !actor.ref) return
        const key = auditActorIdentityKey(actor)
        const cached = readCache(profileCache, key)
        if (cached) {
          profiles.set(key, cached)
          return
        }

        const profile = await loadAgentProfile(request, issuer, actor.ref, discoveryCache, discoveryInflight)
        if (!profile) return
        profiles.set(key, profile)
        writeCache(profileCache, key, profile, PROFILE_TTL_MS)
      })
      return profiles
    },
  }
}

function uniqueAgentActors(actors: readonly AuditActorIdentity[]): AuditActorIdentity[] {
  const unique = new Map<string, AuditActorIdentity>()
  for (const actor of actors) {
    if ((actor.type !== 'oauth' && actor.type !== 'agent') || !actor.ref || !actor.issuer) continue
    unique.set(auditActorIdentityKey(actor), actor)
  }
  return [...unique.values()]
}

function trustedIssuer(value: string | null, trustedOrigins: ReadonlySet<string>): URL | null {
  if (!value) return null
  const issuer = parseSecureUrl(value)
  return issuer && trustedOrigins.has(issuer.origin) ? issuer : null
}

async function loadAgentProfile(
  request: typeof fetch,
  issuer: URL,
  subject: string,
  discoveryCache: Map<string, CacheEntry<string>>,
  discoveryInflight: Map<string, Promise<string | null>>,
): Promise<AuditActorProfile | null> {
  try {
    const template = await agentProfileUriTemplate(request, issuer, discoveryCache, discoveryInflight)
    if (!template) return null
    const url = expandAgentProfileUriTemplate(template, subject)
    if (!url || url.origin !== issuer.origin) return null
    const response = await request(url, {
      headers: { Accept: 'application/json' },
      redirect: 'manual',
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    })
    if (!response.ok || !response.headers.get('content-type')?.includes('application/json')) return null
    const parsed = agentProfileSchema.safeParse(await response.json())
    if (!parsed.success || parsed.data.issuer !== issuer.href.replace(/\/$/, '') || parsed.data.subject !== subject)
      return null
    return {
      name: parsed.data.name,
      image: new URL(parsed.data.picture, url).href,
      profileUrl: new URL(`/agents/${encodeURIComponent(subject)}`, url).href,
      resolved: true,
    }
  } catch {
    return null
  }
}

async function agentProfileUriTemplate(
  request: typeof fetch,
  issuer: URL,
  cache: Map<string, CacheEntry<string>>,
  inflight: Map<string, Promise<string | null>>,
): Promise<string | null> {
  const issuerValue = issuer.href.replace(/\/$/, '')
  const cached = readCache(cache, issuerValue)
  if (cached) return cached
  const existing = inflight.get(issuerValue)
  if (existing) return existing
  const requestPromise = loadAgentProfileUriTemplate(request, issuer, issuerValue, cache)
  inflight.set(issuerValue, requestPromise)
  try {
    return await requestPromise
  } finally {
    if (inflight.get(issuerValue) === requestPromise) inflight.delete(issuerValue)
  }
}

async function loadAgentProfileUriTemplate(
  request: typeof fetch,
  issuer: URL,
  issuerValue: string,
  cache: Map<string, CacheEntry<string>>,
): Promise<string | null> {
  const issuerPath = issuer.pathname === '/' ? '' : issuer.pathname.replace(/\/$/, '')
  const discoveryUrl = new URL(`/.well-known/oauth-authorization-server${issuerPath}`, issuer.origin)
  const response = await request(discoveryUrl, {
    headers: { Accept: 'application/json' },
    redirect: 'manual',
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  })
  if (!response.ok || !response.headers.get('content-type')?.includes('application/json')) return null
  const parsed = discoverySchema.safeParse(await response.json())
  if (!parsed.success || parsed.data.issuer !== issuerValue) return null
  const template = parsed.data.agent_profile_uri_template
  const endpoint = expandAgentProfileUriTemplate(template, 'subject')
  if (!endpoint || endpoint.origin !== issuer.origin) return null
  writeCache(cache, issuerValue, template, DISCOVERY_TTL_MS)
  return template
}

function expandAgentProfileUriTemplate(template: string, subject: string): URL | null {
  const parts = template.split('{subject}')
  if (parts.length !== 2 || parts.some((part) => part.includes('{') || part.includes('}'))) return null
  return parseSecureUrl(`${parts[0]}${encodeURIComponent(subject)}${parts[1]}`)
}

function parseSecureUrl(value: string): URL | null {
  try {
    const url = new URL(value)
    if (url.protocol === 'https:') return url
    if (
      url.protocol === 'http:' &&
      (url.hostname === 'localhost' || url.hostname === '127.0.0.1' || url.hostname === '[::1]')
    ) {
      return url
    }
    return null
  } catch {
    return null
  }
}

function readCache<T>(cache: Map<string, CacheEntry<T>>, key: string): T | null {
  const entry = cache.get(key)
  if (!entry) return null
  if (entry.expiresAt > Date.now()) return entry.value
  cache.delete(key)
  return null
}

function writeCache<T>(cache: Map<string, CacheEntry<T>>, key: string, value: T, ttlMs: number): void {
  if (cache.size >= MAX_CACHE_ENTRIES) {
    const oldest = cache.keys().next()
    if (!oldest.done) cache.delete(oldest.value)
  }
  cache.set(key, { value, expiresAt: Date.now() + ttlMs })
}

async function inBatches<T>(items: readonly T[], size: number, operation: (item: T) => Promise<void>): Promise<void> {
  for (let offset = 0; offset < items.length; offset += size) {
    await Promise.all(items.slice(offset, offset + size).map(operation))
  }
}
