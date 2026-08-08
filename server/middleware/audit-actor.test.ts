import { describe, expect, it } from 'vitest'
import { auditActor } from './audit-actor'
import type { AuthPrincipal } from './platform'

describe('auditActor', () => {
  it('records unauthenticated, user, API key, and device principals directly', () => {
    expect(auditActor(null)).toEqual({ userId: null, actorType: 'anonymous', actorRef: null, actorIssuer: null })
    expect(auditActor({ kind: 'user', userId: 'user-1', orgId: null, authMethod: 'cookie' })).toEqual({
      userId: 'user-1',
      actorType: 'user',
      actorRef: null,
      actorIssuer: null,
    })
    expect(
      auditActor({
        kind: 'api-key',
        userId: 'user-1',
        keyId: 'key-1',
        configId: 'remote-download',
        orgId: null,
        scope: { mode: 'user-workspaces' },
        permissions: null,
        authMethod: 'api-key',
      }),
    ).toEqual({ userId: 'user-1', actorType: 'api_key', actorRef: 'key-1', actorIssuer: null })
    expect(
      auditActor({
        kind: 'downloader',
        downloaderId: 'device-1',
        authMethod: 'bearer',
      }),
    ).toEqual({ userId: null, actorType: 'device', actorRef: 'device-1', actorIssuer: null })
  })

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
