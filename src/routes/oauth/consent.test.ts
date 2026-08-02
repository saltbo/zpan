import { AuthorizationScope } from '@shared/authorization'
import { describe, expect, it } from 'vitest'
import { consentScopeLabel, requestedConsentScopes } from './consent'

describe('requestedConsentScopes', () => {
  it('shows standard and resource scopes in consent', () => {
    expect(
      requestedConsentScopes({
        standardScopes: ['openid', 'offline_access'],
        scopes: [AuthorizationScope.OBJECTS_READ, AuthorizationScope.OBJECTS_CREATE],
      }),
    ).toEqual(['openid', 'offline_access', AuthorizationScope.OBJECTS_READ, AuthorizationScope.OBJECTS_CREATE])
  })

  it('renders standard scopes with user-facing localized labels', () => {
    const labels: Record<string, string> = {
      'settings.oauthApps.oauthStandardScopeOpenid': 'Verify your identity',
      'settings.oauthApps.oauthStandardScopeOfflineAccess': 'Keep access when you are away',
    }
    const translate = (key: string) => labels[key] ?? key

    expect(consentScopeLabel('openid', translate)).toBe('Verify your identity')
    expect(consentScopeLabel('offline_access', translate)).toBe('Keep access when you are away')
  })
})
