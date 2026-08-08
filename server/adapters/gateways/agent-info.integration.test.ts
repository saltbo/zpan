import { createServer, type RequestListener } from 'node:http'
import { afterEach, describe, expect, it } from 'vitest'
import { auditActorIdentityKey } from '../../usecases/ports'
import { createAgentInfoGateway } from './agent-info'

const servers: Array<ReturnType<typeof createServer>> = []

afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => new Promise<void>((resolve) => server.close(() => resolve()))))
})

describe('Agent Info gateway', () => {
  it('discovers and caches an Agent profile for a trusted issuer', async () => {
    let discoveryRequests = 0
    let agentInfoRequests = 0
    const redirects: RequestRedirect[] = []
    const { origin } = await listen((request, response) => {
      if (request.url === '/api/auth/.well-known/openid-configuration') {
        discoveryRequests += 1
        response.setHeader('content-type', 'application/json')
        response.end(
          JSON.stringify({ issuer: `${origin}/api/auth`, agentinfo_endpoint: `${origin}/api/auth/agentinfo` }),
        )
        return
      }
      if (request.url?.startsWith('/api/auth/agentinfo?')) {
        agentInfoRequests += 1
        const subject = new URL(request.url, origin).searchParams.get('sub')
        response.setHeader('content-type', 'application/json')
        response.setHeader('cache-control', 'public, max-age=300')
        response.end(
          JSON.stringify({
            iss: `${origin}/api/auth`,
            sub: subject,
            name: subject === 'agt_1' ? 'Mac Agent' : 'Second Agent',
            picture: `${origin}/agent.svg`,
            updated_at: 1,
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
      resolved: true,
    })
    expect(second).toEqual(first)
    expect(discoveryRequests).toBe(1)
    expect(agentInfoRequests).toBe(2)
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

  it('rejects an Agent Info response for a different subject', async () => {
    const { origin } = await listen((request, response) => {
      response.setHeader('content-type', 'application/json')
      if (request.url === '/api/auth/.well-known/openid-configuration') {
        response.end(
          JSON.stringify({ issuer: `${origin}/api/auth`, agentinfo_endpoint: `${origin}/api/auth/agentinfo` }),
        )
        return
      }
      response.end(JSON.stringify({ iss: `${origin}/api/auth`, sub: 'agt_other', name: 'Wrong Agent' }))
    })
    const gateway = createAgentInfoGateway()
    const identity = { type: 'oauth', ref: 'agt_1', issuer: `${origin}/api/auth` } as const

    const profiles = await gateway.resolve([identity], new Set([origin]))

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

  it('rejects Agent Info endpoints on a different origin', async () => {
    const { origin } = await listen((_request, response) => {
      response.setHeader('content-type', 'application/json')
      response.end(
        JSON.stringify({ issuer: `${origin}/api/auth`, agentinfo_endpoint: 'https://untrusted.example/agentinfo' }),
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
