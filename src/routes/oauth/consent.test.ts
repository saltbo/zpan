import { AuthorizationScope } from '@shared/authorization'
import { describe, expect, it } from 'vitest'
import { requestedConsentScopes } from './consent'

describe('requestedConsentScopes', () => {
  it('shows standard and resource scopes in consent', () => {
    expect(
      requestedConsentScopes({
        standardScopes: ['openid', 'offline_access'],
        scopes: [AuthorizationScope.OBJECTS_READ, AuthorizationScope.OBJECTS_CREATE],
      }),
    ).toEqual(['openid', 'offline_access', AuthorizationScope.OBJECTS_READ, AuthorizationScope.OBJECTS_CREATE])
  })
})
