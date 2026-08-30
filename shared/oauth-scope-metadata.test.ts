import { describe, expect, it } from 'vitest'
import { CANONICAL_AUTHORIZATION_SCOPES } from './authorization'
import { OAUTH_STANDARD_SCOPES } from './oauth'
import {
  getOAuthScopeMetadata,
  OAUTH_GRANT_SCOPE_METADATA,
  OAUTH_STANDARD_SCOPE_METADATA,
} from './oauth-scope-metadata'

describe('OAuth scope metadata completeness', () => {
  it('requires explicit bilingual metadata for every published ZPan scope', () => {
    expect(Object.keys(OAUTH_GRANT_SCOPE_METADATA).sort()).toEqual([...CANONICAL_AUTHORIZATION_SCOPES].sort())

    for (const scope of CANONICAL_AUTHORIZATION_SCOPES) {
      expect(OAUTH_GRANT_SCOPE_METADATA[scope].description.en.trim()).not.toBe('')
      expect(OAUTH_GRANT_SCOPE_METADATA[scope].description.zh.trim()).not.toBe('')
    }
  })

  it('requires explicit bilingual metadata for every standard OAuth scope', () => {
    expect(Object.keys(OAUTH_STANDARD_SCOPE_METADATA).sort()).toEqual([...OAUTH_STANDARD_SCOPES].sort())
  })

  it('does not invent metadata for an unknown scope', () => {
    expect(getOAuthScopeMetadata('future:scope')).toBeNull()
  })
})
