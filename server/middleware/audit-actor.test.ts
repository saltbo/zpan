import { describe, expect, it } from 'vitest'
import { auditActor } from './audit-actor'
import type { AuthPrincipal } from './platform'

describe('auditActor', () => {
  it('records OAuth principals as delegated Agent actors', () => {
    const principal: AuthPrincipal = {
      kind: 'oauth',
      userId: 'user-1',
      actorIssuer: 'https://id.realmroot.dev/api/auth',
      actorSubject: 'agt_agent-1',
      clientId: 'dynamic-client',
      orgId: 'org-1',
      scopes: [],
      authMethod: 'bearer',
    }

    expect(auditActor(principal)).toEqual({
      userId: 'user-1',
      actorType: 'oauth',
      actorRef: 'agt_agent-1',
      actorIssuer: 'https://id.realmroot.dev/api/auth',
    })
  })

  it('records downloader bootstrap principals as user actors', () => {
    const principal: AuthPrincipal = {
      kind: 'downloader-bootstrap',
      userId: 'user-1',
      sessionToken: 'bootstrap-token',
      scope: 'downloader:register',
      authMethod: 'bearer',
    }

    expect(auditActor(principal)).toEqual({
      userId: 'user-1',
      actorType: 'user',
      actorRef: null,
      actorIssuer: null,
    })
  })
})
