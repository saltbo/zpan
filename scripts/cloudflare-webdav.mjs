import { createHash } from 'node:crypto'

const API_BASE = 'https://api.cloudflare.com/client/v4'
const TRANSFORM_PHASE = 'http_request_transform'
const MANAGED_REF_PREFIX = 'zpan_webdav_'
const RULESET_NAME = 'ZPan WebDAV URL Rewrite'
const RULE_DESCRIPTION_PREFIX = 'Managed by ZPan WebDAV:'
const DEFAULT_WORKER_NAME = 'zpan'
const VERIFY_ATTEMPTS = 30
const VERIFY_DELAY_MS = 10_000

export function parseCloudflareWebDavUrl(raw) {
  const value = raw?.trim()
  if (!value) return null

  const url = new URL(value)
  if (url.protocol !== 'https:') throw new Error('WEBDAV_PUBLIC_URL must use https for Cloudflare deployments')
  if (url.username || url.password || url.pathname !== '/' || url.search || url.hash) {
    throw new Error('WEBDAV_PUBLIC_URL must be an origin without credentials, path, query, or fragment')
  }
  return url
}

export function findHostnameZone(hostname, zones) {
  const matches = zones
    .filter((zone) => hostname === zone.name || hostname.endsWith(`.${zone.name}`))
    .sort((a, b) => b.name.length - a.name.length)
  if (matches.length === 0) throw new Error(`No accessible Cloudflare zone contains ${hostname}`)
  if (matches.length > 1 && matches[0].name.length === matches[1].name.length) {
    throw new Error(`Multiple accessible Cloudflare zones match ${hostname}`)
  }
  return matches[0]
}

export function managedRuleRef(hostname) {
  return `${MANAGED_REF_PREFIX}${createHash('sha256').update(hostname).digest('hex').slice(0, 16)}`
}

export function buildRewriteRule(hostname) {
  return {
    ref: managedRuleRef(hostname),
    description: `${RULE_DESCRIPTION_PREFIX} ${hostname}`,
    expression: `http.host eq "${hostname}"`,
    action: 'rewrite',
    action_parameters: {
      uri: {
        path: {
          expression: 'concat("/dav", http.request.uri.path)',
        },
      },
    },
    enabled: true,
  }
}

export async function syncCloudflareWebDav({
  token,
  accountId,
  publicUrl,
  workerName = DEFAULT_WORKER_NAME,
  apiFetch = fetch,
  verifyFetch = fetch,
  sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  verifyAttempts = VERIFY_ATTEMPTS,
  verifyDelayMs = VERIFY_DELAY_MS,
}) {
  if (!token) throw new Error('CLOUDFLARE_API_TOKEN is required')
  if (!accountId) throw new Error('CLOUDFLARE_ACCOUNT_ID is required')

  const desiredUrl = parseCloudflareWebDavUrl(publicUrl)
  const client = createApiClient({ token, apiFetch })
  const zones = await listZones(client, accountId)
  const managedRules = await listManagedRules(client, zones)
  const domains = await listWorkerDomains(client, accountId)

  let desiredRule = null
  if (desiredUrl) {
    const zone = findHostnameZone(desiredUrl.hostname, zones)
    desiredRule = await ensureRewriteRule(client, zone, managedRules, desiredUrl.hostname)
    await ensureWorkerDomain(client, accountId, domains, {
      hostname: desiredUrl.hostname,
      service: workerName,
      zone_id: zone.id,
      zone_name: zone.name,
    })
    await verifyWebDavDomain(desiredUrl, { verifyFetch, sleep, verifyAttempts, verifyDelayMs })
  }

  const staleRules = managedRules.filter(
    (managed) => !desiredRule || managed.zone.id !== desiredRule.zone.id || managed.rule.id !== desiredRule.rule.id,
  )
  const staleHostnames = new Set(
    staleRules
      .map(({ rule }) => managedRuleHostname(rule))
      .filter((hostname) => hostname !== desiredUrl?.hostname),
  )

  let removedDomains = 0
  for (const domain of domains) {
    if (domain.service === workerName && staleHostnames.has(domain.hostname)) {
      await client.request(`/accounts/${accountId}/workers/domains/${domain.id}`, { method: 'DELETE' })
      removedDomains += 1
    }
  }
  for (const managed of staleRules) {
    await client.request(`/zones/${managed.zone.id}/rulesets/${managed.rulesetId}/rules/${managed.rule.id}`, {
      method: 'DELETE',
    })
  }

  return {
    hostname: desiredUrl?.hostname ?? null,
    removedRules: staleRules.length,
    removedDomains,
  }
}

function createApiClient({ token, apiFetch }) {
  return {
    async request(path, { method = 'GET', body, allowNotFound = false } = {}) {
      const response = await apiFetch(`${API_BASE}${path}`, {
        method,
        headers: {
          Authorization: `Bearer ${token}`,
          ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      })
      if (allowNotFound && response.status === 404) return null

      const payload = await response.json().catch(() => null)
      if (!response.ok || !payload?.success) {
        const errors = Array.isArray(payload?.errors)
          ? payload.errors.map((error) => error.message || error.code).join('; ')
          : `HTTP ${response.status}`
        throw new Error(`Cloudflare API ${method} ${path} failed: ${errors}`)
      }
      return payload
    },
  }
}

async function listZones(client, accountId) {
  const zones = []
  let page = 1
  let totalPages = 1
  do {
    const query = new URLSearchParams({ 'account.id': accountId, page: String(page), per_page: '50' })
    const payload = await client.request(`/zones?${query}`)
    zones.push(...payload.result)
    totalPages = payload.result_info?.total_pages ?? 1
    page += 1
  } while (page <= totalPages)
  return zones
}

async function getTransformRuleset(client, zoneId) {
  const payload = await client.request(`/zones/${zoneId}/rulesets/phases/${TRANSFORM_PHASE}/entrypoint`, {
    allowNotFound: true,
  })
  return payload?.result ?? null
}

async function listManagedRules(client, zones) {
  const managed = []
  for (const zone of zones) {
    const ruleset = await getTransformRuleset(client, zone.id)
    if (!ruleset) continue
    for (const rule of ruleset.rules ?? []) {
      if (rule.ref?.startsWith(MANAGED_REF_PREFIX)) {
        managedRuleHostname(rule)
        managed.push({ zone, rulesetId: ruleset.id, rule })
      }
    }
  }
  return managed
}

async function ensureTransformRuleset(client, zone) {
  const existing = await getTransformRuleset(client, zone.id)
  if (existing) return existing
  const payload = await client.request(`/zones/${zone.id}/rulesets`, {
    method: 'POST',
    body: {
      name: RULESET_NAME,
      description: 'ZPan-managed request rewrites',
      kind: 'zone',
      phase: TRANSFORM_PHASE,
    },
  })
  return payload.result
}

async function ensureRewriteRule(client, zone, managedRules, hostname) {
  const definition = buildRewriteRule(hostname)
  const existing = managedRules.find(
    (managed) => managed.zone.id === zone.id && managed.rule.ref === definition.ref,
  )
  if (existing) {
    if (!sameRule(existing.rule, definition)) {
      const payload = await client.request(
        `/zones/${zone.id}/rulesets/${existing.rulesetId}/rules/${existing.rule.id}`,
        { method: 'PATCH', body: definition },
      )
      existing.rule = payload.result.rules.find((rule) => rule.ref === definition.ref) ?? {
        ...definition,
        id: existing.rule.id,
      }
    }
    return existing
  }

  const ruleset = await ensureTransformRuleset(client, zone)
  const payload = await client.request(`/zones/${zone.id}/rulesets/${ruleset.id}/rules`, {
    method: 'POST',
    body: definition,
  })
  const rule = payload.result.rules.find((candidate) => candidate.ref === definition.ref)
  if (!rule?.id) throw new Error(`Cloudflare did not return the created WebDAV rule for ${hostname}`)
  return { zone, rulesetId: ruleset.id, rule }
}

function sameRule(rule, definition) {
  return (
    rule.ref === definition.ref &&
    rule.description === definition.description &&
    rule.expression === definition.expression &&
    rule.action === definition.action &&
    rule.enabled !== false &&
    rule.action_parameters?.uri?.path?.expression === definition.action_parameters.uri.path.expression
  )
}

function managedRuleHostname(rule) {
  const match = /^http\.host eq "([^"\\]+)"$/.exec(rule.expression ?? '')
  if (!match) throw new Error(`Managed WebDAV rule ${rule.ref} has an unexpected expression`)
  return match[1]
}

async function listWorkerDomains(client, accountId) {
  const payload = await client.request(`/accounts/${accountId}/workers/domains`)
  return payload.result
}

async function ensureWorkerDomain(client, accountId, domains, desired) {
  const existing = domains.find((domain) => domain.hostname === desired.hostname)
  if (existing?.service === desired.service && existing.zone_id === desired.zone_id) return
  if (existing && existing.service !== desired.service) {
    throw new Error(`${desired.hostname} is already attached to Worker ${existing.service}`)
  }
  await client.request(`/accounts/${accountId}/workers/domains`, { method: 'PUT', body: desired })
}

async function verifyWebDavDomain(url, { verifyFetch, sleep, verifyAttempts, verifyDelayMs }) {
  for (let attempt = 1; attempt <= verifyAttempts; attempt += 1) {
    try {
      const response = await verifyFetch(url, { method: 'OPTIONS', redirect: 'manual' })
      if (response.status === 401 && response.headers.get('WWW-Authenticate') === 'Basic realm="ZPan WebDAV"') {
        return
      }
    } catch (error) {
      if (attempt === verifyAttempts) throw error
    }
    if (attempt < verifyAttempts) await sleep(verifyDelayMs)
  }
  throw new Error(`WebDAV custom domain did not become ready: ${url.origin}`)
}
