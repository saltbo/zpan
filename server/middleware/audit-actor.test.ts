import { describe, expect, it } from 'vitest'
import { auditActor } from './audit-actor'
import type { AuthPrincipal } from './platform'

describe('auditActor', () => {
  it('records Agent OAuth principals as delegated Agent actors', () => {
    const principal: AuthPrincipal = {
      kind: 'agent-oauth',
      userId: 'user-1',
      grantId: 'grant-1',
      clientId: 'zpan-agent',
      orgId: 'org-1',
      scopes: [],
      authMethod: 'bearer',
    }

    expect(auditActor(principal)).toEqual({
      userId: 'user-1',
      actorType: 'agent_oauth',
      actorRef: 'grant-1',
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
    })
  })
})
