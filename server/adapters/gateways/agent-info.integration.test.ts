import { createServer, type RequestListener } from 'node:http'
import { afterEach, describe, expect, it } from 'vitest'
import { auditActorIdentityKey } from '../../usecases/ports'
import { createAgentInfoGateway } from './agent-info'

const servers: Array<ReturnType<typeof createServer>> = []

afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => new Promise<void>((resolve) => server.close(() => resolve()))))
})

describe('Agent profile gateway', () => {
  it('discovers and caches an Agent profile for a trusted issuer', async () => {
    let discoveryRequests = 0
    let profileRequests = 0
    const redirects: RequestRedirect[] = []
    const { origin } = await listen((request, response) => {
      if (request.url === '/.well-known/oauth-authorization-server/api/auth') {
        discoveryRequests += 1
        response.setHeader('content-type', 'application/json')
        response.end(
          JSON.stringify({
            issuer: `${origin}/api/auth`,
            agent_profile_uri_template: `${origin}/api/public/agents/{subject}`,
          }),
        )
        return
      }
      if (request.url?.startsWith('/api/public/agents/')) {
        profileRequests += 1
        const subject = decodeURIComponent(request.url.slice('/api/public/agents/'.length))
        response.setHeader('content-type', 'application/json')
        response.setHeader('cache-control', 'public, max-age=300')
        response.end(
          JSON.stringify({
            type: 'agent',
            view: 'summary',
            issuer: `${origin}/api/auth`,
            subject,
            name: subject === 'agt_1' ? 'Mac Agent' : 'Second Agent',
            picture: `${origin}/agent.svg`,
            createdAt: '2026-08-08T12:00:00.000Z',
            updatedAt: '2026-08-08T12:00:00.000Z',
          }),
        )
        return
      }
      response.statusCode = 404
      response.end()
    })
    const gateway = createAgentInfoGateway((input, init) => {
      if (init?.redirect) redirects.push(init.redirect)
      return fetch(input, init)
    })
    const identity = { type: 'oauth', ref: 'agt_1', issuer: `${origin}/api/auth` } as const
    const secondIdentity = { type: 'oauth', ref: 'agt_2', issuer: `${origin}/api/auth` } as const
    const trustedOrigins = new Set([origin])

    const first = await gateway.resolve([identity, secondIdentity], trustedOrigins)
    const second = await gateway.resolve([identity, secondIdentity], trustedOrigins)

    expect(first.get(auditActorIdentityKey(identity))).toEqual({
      name: 'Mac Agent',
      image: `${origin}/agent.svg`,
      profileUrl: `${origin}/agents/agt_1`,
      resolved: true,
    })
    expect(second).toEqual(first)
    expect(discoveryRequests).toBe(1)
    expect(profileRequests).toBe(2)
    expect(redirects).toEqual(['manual', 'manual', 'manual'])
  })

  it('does not contact an untrusted issuer', async () => {
    let requests = 0
    const { origin } = await listen((_request, response) => {
      requests += 1
      response.end('{}')
    })
    const gateway = createAgentInfoGateway()
    const identity = { type: 'oauth', ref: 'agt_1', issuer: `${origin}/api/auth` } as const

    const profiles = await gateway.resolve([identity], new Set())

    expect(profiles.size).toBe(0)
    expect(requests).toBe(0)
  })

  it('URL-encodes the verified Agent subject into the discovered profile template', async () => {
    const { origin } = await listen((request, response) => {
      response.setHeader('content-type', 'application/json')
      if (request.url === '/.well-known/oauth-authorization-server/api/auth') {
        response.end(
          JSON.stringify({
            issuer: `${origin}/api/auth`,
            agent_profile_uri_template: `${origin}/api/public/agents/{subject}`,
          }),
        )
        return
      }
      if (request.url !== '/api/public/agents/agt_encoded%2Fvalue') {
        response.statusCode = 404
        response.end()
        return
      }
      response.end(
        JSON.stringify({
          type: 'agent',
          view: 'summary',
          issuer: `${origin}/api/auth`,
          subject: 'agt_encoded/value',
          name: 'Encoded Agent',
          picture: `${origin}/agent.svg`,
          createdAt: '2026-08-08T12:00:00.000Z',
          updatedAt: '2026-08-08T12:00:00.000Z',
        }),
      )
    })
    const gateway = createAgentInfoGateway()
    const identity = { type: 'agent', ref: 'agt_encoded/value', issuer: `${origin}/api/auth` } as const

    const profiles = await gateway.resolve([identity], new Set([origin]))

    expect(profiles.get(auditActorIdentityKey(identity))?.name).toBe('Encoded Agent')
  })

  it('rejects an Agent profile response for a different subject', async () => {
    const { origin } = await listen((request, response) => {
      response.setHeader('content-type', 'application/json')
      if (request.url === '/.well-known/oauth-authorization-server/api/auth') {
        response.end(
          JSON.stringify({
            issuer: `${origin}/api/auth`,
            agent_profile_uri_template: `${origin}/api/public/agents/{subject}`,
          }),
        )
        return
      }
      response.end(
        JSON.stringify({
          type: 'agent',
          view: 'summary',
          issuer: `${origin}/api/auth`,
          subject: 'agt_other',
          name: 'Wrong Agent',
          picture: `${origin}/agent.svg`,
          createdAt: '2026-08-08T12:00:00.000Z',
          updatedAt: '2026-08-08T12:00:00.000Z',
        }),
      )
    })
    const gateway = createAgentInfoGateway()
    const identity = { type: 'oauth', ref: 'agt_1', issuer: `${origin}/api/auth` } as const

    const profiles = await gateway.resolve([identity], new Set([origin]))

    expect(profiles.size).toBe(0)
  })

  it('rejects an Agent profile response for a different issuer', async () => {
    const { origin } = await listen((request, response) => {
      response.setHeader('content-type', 'application/json')
      if (request.url === '/.well-known/oauth-authorization-server/api/auth') {
        response.end(
          JSON.stringify({
            issuer: `${origin}/api/auth`,
            agent_profile_uri_template: `${origin}/api/public/agents/{subject}`,
          }),
        )
        return
      }
      response.end(
        JSON.stringify({
          type: 'agent',
          view: 'summary',
          issuer: 'https://other.example/api/auth',
          subject: 'agt_1',
          name: 'Wrong Issuer Agent',
          picture: `${origin}/agent.svg`,
          createdAt: '2026-08-08T12:00:00.000Z',
          updatedAt: '2026-08-08T12:00:00.000Z',
        }),
      )
    })
    const gateway = createAgentInfoGateway()

    const profiles = await gateway.resolve(
      [{ type: 'oauth', ref: 'agt_1', issuer: `${origin}/api/auth` }],
      new Set([origin]),
    )

    expect(profiles.size).toBe(0)
  })

  it('rejects invalid discovery documents and ignores incomplete actor identities', async () => {
    let requests = 0
    const { origin } = await listen((_request, response) => {
      requests += 1
      response.statusCode = 503
      response.end()
    })
    const gateway = createAgentInfoGateway()

    const profiles = await gateway.resolve(
      [
        { type: 'user', ref: 'user-1', issuer: origin },
        { type: 'agent', ref: null, issuer: origin },
        { type: 'agent', ref: 'agt-1', issuer: null },
        { type: 'agent', ref: 'agt-1', issuer: `${origin}/api/auth` },
      ],
      new Set([origin]),
    )

    expect(profiles.size).toBe(0)
    expect(requests).toBe(1)
  })

  it('rejects Agent profile templates on a different origin', async () => {
    const { origin } = await listen((_request, response) => {
      response.setHeader('content-type', 'application/json')
      response.end(
        JSON.stringify({
          issuer: `${origin}/api/auth`,
          agent_profile_uri_template: 'https://untrusted.example/agents/{subject}',
        }),
      )
    })
    const gateway = createAgentInfoGateway()

    const profiles = await gateway.resolve(
      [{ type: 'agent', ref: 'agt-1', issuer: `${origin}/api/auth` }],
      new Set([origin]),
    )

    expect(profiles.size).toBe(0)
  })

  it('rejects profile templates without exactly one subject expression', async () => {
    const { origin } = await listen((_request, response) => {
      response.setHeader('content-type', 'application/json')
      response.end(
        JSON.stringify({
          issuer: `${origin}/api/auth`,
          agent_profile_uri_template: `${origin}/api/public/agents/static`,
        }),
      )
    })
    const gateway = createAgentInfoGateway()

    const profiles = await gateway.resolve(
      [{ type: 'agent', ref: 'agt-1', issuer: `${origin}/api/auth` }],
      new Set([origin]),
    )

    expect(profiles.size).toBe(0)
  })
})

async function listen(handler: RequestListener): Promise<{ origin: string }> {
  const server = createServer(handler)
  servers.push(server)
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('test_server_address_missing')
  return { origin: `http://127.0.0.1:${address.port}` }
}
