import { describe, expect, it } from 'vitest'
import { auditActor } from './audit-actor'
import type { AuthPrincipal } from './platform'

describe('auditActor', () => {
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
