import { describe, expect, it } from 'vitest'
import {
  AGENT_GRANTABLE_AUTHORIZATION_SCOPES,
  AuthorizationScope,
  authorizationScope,
  CANONICAL_AUTHORIZATION_SCOPES,
  scopePermissions,
} from './authorization'

describe('authorization scope registry', () => {
  it('uses lowercase resource:action scopes without wildcard semantics', () => {
    for (const scope of CANONICAL_AUTHORIZATION_SCOPES) {
      expect(scope).toMatch(/^[a-z][a-z-]*s?:[a-z][a-z-]*$/)
      expect(scope).not.toContain('*')
      expect(scope).not.toContain('zpan')
    }
    expect(authorizationScope('download-tasks', 'read')).toBe(AuthorizationScope.DOWNLOAD_TASKS_READ)
    expect(authorizationScope('remoteDownload', 'read')).toBeNull()
    expect(authorizationScope('objects', '*')).toBeNull()
  })

  it('keeps permanent object purge out of agent-grantable scopes', () => {
    expect(CANONICAL_AUTHORIZATION_SCOPES).toContain(AuthorizationScope.OBJECTS_PURGE)
    expect(AGENT_GRANTABLE_AUTHORIZATION_SCOPES).not.toContain(AuthorizationScope.OBJECTS_PURGE)
    expect(scopePermissions([AuthorizationScope.OBJECTS_DELETE])).toEqual({ objects: ['delete'] })
  })
})
