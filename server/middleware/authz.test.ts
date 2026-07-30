import { AuthorizationScope } from '@shared/authorization'
import { Hono } from 'hono'
import { describe, expect, it, vi } from 'vitest'
import { authorize, type RouteAuthorizationDeclaration } from './authz'
import { type AuthzContext, type Env, workspaceOrgId } from './platform'

function probeApp(context: AuthzContext, declaration: RouteAuthorizationDeclaration) {
  const recordGrantUse = vi.fn(async () => {})
  const app = new Hono<Env>()
  app.use('/probe', async (c, next) => {
    c.set('authzContext', context)
    c.set('platform', { db: { kind: 'unit-db' } } as unknown as Env['Variables']['platform'])
    c.set('deps', {
      agentOAuth: { recordGrantUse },
      audit: { record: vi.fn() },
      org: {
        getMemberRole: vi.fn(async () => 'owner'),
        findPersonalOrg: vi.fn(async () => workspaceOrgId(context)),
      },
    } as unknown as Env['Variables']['deps'])
    await next()
  })
  app.get('/probe', authorize(declaration), (c) => c.json({ ok: true }))
  return { app, recordGrantUse }
}

describe('authorize Agent OAuth grant-use tracking', () => {
  const context: AuthzContext = {
    credential: 'agent_oauth',
    userId: 'user-1',
    workspace: { mode: 'bound', orgId: 'org-1' },
    grantedScopes: new Set([AuthorizationScope.OBJECTS_READ]),
    actor: { type: 'agent_oauth', ref: 'grant-1' },
    state: { clientId: 'zpan-agent' },
  }

  it('records actual Agent OAuth use for scoped protected routes', async () => {
    const { app, recordGrantUse } = probeApp(context, {
      scopes: [AuthorizationScope.OBJECTS_READ],
    })

    const res = await app.request('/probe')

    expect(res.status).toBe(200)
    expect(recordGrantUse).toHaveBeenCalledTimes(1)
    expect(recordGrantUse).toHaveBeenCalledWith(
      { kind: 'unit-db' },
      expect.objectContaining({
        grantId: 'grant-1',
        userId: 'user-1',
        orgId: 'org-1',
        now: expect.any(Date),
      }),
    )
  })

  it('does not record public access as grant use', async () => {
    const { app, recordGrantUse } = probeApp(context, { public: true })

    const res = await app.request('/probe')

    expect(res.status).toBe(200)
    expect(recordGrantUse).not.toHaveBeenCalled()
  })

  it('does not record non-Agent OAuth protected access as grant use', async () => {
    const { app, recordGrantUse } = probeApp(
      {
        credential: 'session',
        userId: 'user-1',
        workspace: { mode: 'selected', orgId: 'org-1' },
        grantedScopes: null,
        actor: { type: 'user', ref: 'user-1' },
        state: { firstParty: true },
      },
      { scopes: [AuthorizationScope.OBJECTS_READ] },
    )

    const res = await app.request('/probe')

    expect(res.status).toBe(200)
    expect(recordGrantUse).not.toHaveBeenCalled()
  })
})
