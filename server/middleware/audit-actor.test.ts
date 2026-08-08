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

  it('records a device as the actor behind a task upload credential', () => {
    const principal: AuthPrincipal = {
      kind: 'download-task-upload',
      downloaderId: 'device-1',
      taskId: 'task-1',
      orgId: 'org-1',
      targetFolder: 'Downloads',
      createdByUserId: 'user-1',
      scopes: ['objects:create'],
      authMethod: 'bearer',
    }

    expect(auditActor(principal)).toEqual({
      userId: 'user-1',
      actorType: 'device',
      actorRef: 'device-1',
      actorIssuer: null,
    })
  })
})
