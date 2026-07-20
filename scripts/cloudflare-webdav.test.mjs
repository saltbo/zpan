import { describe, expect, it } from 'vitest'
import {
  buildRewriteRule,
  findPrimaryWorkerDomain,
  managedRuleRef,
  syncCloudflareWebDav,
  webDavHostname,
} from './cloudflare-webdav.mjs'

function envelope(result, init = {}) {
  return Response.json({ success: true, errors: [], messages: [], result, ...init })
}

function createCloudflareMock() {
  const state = {
    calls: [],
    rulesets: new Map(),
    domains: [],
    nextRuleId: 1,
    nextDomainId: 1,
  }

  const apiFetch = async (input, init = {}) => {
    const url = new URL(String(input))
    const method = init.method ?? 'GET'
    const body = init.body ? JSON.parse(String(init.body)) : null
    state.calls.push({ method, path: url.pathname, body })

    const entrypoint = /^\/client\/v4\/zones\/([^/]+)\/rulesets\/phases\/http_request_transform\/entrypoint$/.exec(
      url.pathname,
    )
    if (entrypoint && method === 'GET') {
      const ruleset = state.rulesets.get(entrypoint[1])
      return ruleset
        ? envelope(ruleset)
        : Response.json({ success: false, errors: [{ message: 'not found' }] }, { status: 404 })
    }

    const rulesetCollection = /^\/client\/v4\/zones\/([^/]+)\/rulesets$/.exec(url.pathname)
    if (rulesetCollection && method === 'POST') {
      const ruleset = { id: `ruleset-${rulesetCollection[1]}`, ...body, rules: [] }
      state.rulesets.set(rulesetCollection[1], ruleset)
      return envelope(ruleset)
    }

    const ruleCollection = /^\/client\/v4\/zones\/([^/]+)\/rulesets\/([^/]+)\/rules$/.exec(url.pathname)
    if (ruleCollection && method === 'POST') {
      const ruleset = state.rulesets.get(ruleCollection[1])
      const rule = { ...body, id: `rule-${state.nextRuleId++}` }
      ruleset.rules.push(rule)
      return envelope(ruleset)
    }

    const ruleItem = /^\/client\/v4\/zones\/([^/]+)\/rulesets\/([^/]+)\/rules\/([^/]+)$/.exec(url.pathname)
    if (ruleItem && method === 'PATCH') {
      const ruleset = state.rulesets.get(ruleItem[1])
      const index = ruleset.rules.findIndex((rule) => rule.id === ruleItem[3])
      ruleset.rules[index] = { ...body, id: ruleItem[3] }
      return envelope(ruleset)
    }
    if (ruleItem && method === 'DELETE') {
      const ruleset = state.rulesets.get(ruleItem[1])
      ruleset.rules = ruleset.rules.filter((rule) => rule.id !== ruleItem[3])
      return envelope(ruleset)
    }

    if (url.pathname === '/client/v4/accounts/account-1/workers/domains' && method === 'GET') {
      return envelope(state.domains)
    }
    if (url.pathname === '/client/v4/accounts/account-1/workers/domains' && method === 'PUT') {
      const domain = { ...body, id: `domain-${state.nextDomainId++}` }
      state.domains.push(domain)
      return envelope(domain)
    }

    const domainItem = /^\/client\/v4\/accounts\/account-1\/workers\/domains\/([^/]+)$/.exec(url.pathname)
    if (domainItem && method === 'DELETE') {
      state.domains = state.domains.filter((domain) => domain.id !== domainItem[1])
      return envelope(null)
    }

    throw new Error(`Unexpected Cloudflare request: ${method} ${url.pathname}`)
  }

  return { state, apiFetch }
}

const readyFetch = async () =>
  new Response('Unauthorized', {
    status: 401,
    headers: { 'WWW-Authenticate': 'Basic realm="ZPan WebDAV"' },
  })

describe('Cloudflare WebDAV deployment sync', () => {
  it('derives the fixed hostname and builds a deterministic rewrite', () => {
    expect(webDavHostname('files.example.com')).toBe('dav.files.example.com')
    const rule = buildRewriteRule('dav.files.example.com')
    expect(rule.ref).toBe(managedRuleRef('dav.files.example.com'))
    expect(rule.expression).toBe('http.host eq "dav.files.example.com"')
    expect(rule.action_parameters.uri.path.expression).toBe('concat("/dav", http.request.uri.path)')
  })

  it('identifies the primary domain and excludes its fixed DAV companion', () => {
    const main = { hostname: 'files.example.com' }
    const dav = { hostname: 'dav.files.example.com' }
    expect(findPrimaryWorkerDomain([main, dav])).toBe(main)
    expect(() => findPrimaryWorkerDomain([main, { hostname: 'other.example.com' }])).toThrow(
      'Multiple primary Worker Custom Domains',
    )
  })

  it('creates the rule and domain once, then converges without rewriting unrelated state', async () => {
    const { state, apiFetch } = createCloudflareMock()
    state.domains.push({
      id: 'domain-main',
      hostname: 'files.example.com',
      service: 'zpan',
      zone_id: 'zone-child',
      zone_name: 'files.example.com',
    })
    const options = {
      token: 'token',
      accountId: 'account-1',
      apiFetch,
      verifyFetch: readyFetch,
      sleep: async () => {},
    }

    await syncCloudflareWebDav(options)
    expect(state.domains).toEqual([
      expect.objectContaining({ hostname: 'files.example.com', service: 'zpan', zone_id: 'zone-child' }),
      expect.objectContaining({ hostname: 'dav.files.example.com', service: 'zpan', zone_id: 'zone-child' }),
    ])
    expect(state.rulesets.get('zone-child').rules).toEqual([
      expect.objectContaining({ ref: managedRuleRef('dav.files.example.com') }),
    ])

    const mutations = state.calls.filter((call) => ['POST', 'PUT', 'PATCH', 'DELETE'].includes(call.method)).length
    await syncCloudflareWebDav(options)
    expect(state.calls.filter((call) => ['POST', 'PUT', 'PATCH', 'DELETE'].includes(call.method))).toHaveLength(
      mutations,
    )
  })

  it('verifies a replacement before removing the previous managed domain and rule', async () => {
    const { state, apiFetch } = createCloudflareMock()
    state.domains.push({
      id: 'domain-old-main',
      hostname: 'old.example.com',
      service: 'zpan',
      zone_id: 'zone-parent',
      zone_name: 'example.com',
    })
    const base = {
      token: 'token',
      accountId: 'account-1',
      apiFetch,
      verifyFetch: readyFetch,
      sleep: async () => {},
    }
    await syncCloudflareWebDav(base)
    state.domains = state.domains.filter((domain) => domain.hostname !== 'old.example.com')
    state.domains.push({
      id: 'domain-new-main',
      hostname: 'new.example.com',
      service: 'zpan',
      zone_id: 'zone-parent',
      zone_name: 'example.com',
    })
    await syncCloudflareWebDav(base)

    expect(state.domains.map((domain) => domain.hostname).sort()).toEqual(['dav.new.example.com', 'new.example.com'])
    expect(state.rulesets.get('zone-parent').rules.map((rule) => rule.ref)).toEqual([
      managedRuleRef('dav.new.example.com'),
    ])
  })

  it('removes managed resources when the primary Worker domain is removed', async () => {
    const { state, apiFetch } = createCloudflareMock()
    state.domains.push({
      id: 'domain-main',
      hostname: 'example.com',
      service: 'zpan',
      zone_id: 'zone-parent',
      zone_name: 'example.com',
    })
    const base = {
      token: 'token',
      accountId: 'account-1',
      apiFetch,
      verifyFetch: readyFetch,
      sleep: async () => {},
    }
    await syncCloudflareWebDav(base)
    state.domains = state.domains.filter((domain) => domain.hostname !== 'example.com')
    const result = await syncCloudflareWebDav(base)

    expect(result).toMatchObject({ hostname: null, removedRules: 1, removedDomains: 1 })
    expect(state.domains).toEqual([])
    expect(state.rulesets.get('zone-parent').rules).toEqual([])
  })

  it('fails loudly when Cloudflare rejects a required API call', async () => {
    await expect(
      syncCloudflareWebDav({
        token: 'token',
        accountId: 'account-1',
        apiFetch: async () =>
          Response.json({ success: false, errors: [{ message: 'permission denied' }] }, { status: 403 }),
        verifyFetch: readyFetch,
      }),
    ).rejects.toThrow('permission denied')
  })
})
