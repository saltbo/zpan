import { describe, expect, it } from 'vitest'
import { generateTeamOrgSlug, generateUserOrgSlug, isPersonalOrgLike, isTeamOrgLike } from './org-slugs'

describe('org slug helpers', () => {
  it('generates user and team slugs with the expected prefixes and length', () => {
    expect(generateUserOrgSlug()).toMatch(/^u[a-z0-9]{16}$/)
    expect(generateTeamOrgSlug()).toMatch(/^t[a-z0-9]{16}$/)
  })

  it('identifies personal orgs by metadata and legacy slug prefix', () => {
    expect(isPersonalOrgLike({ slug: 'u1234567890abcdef', metadata: { type: 'personal' } })).toBe(true)
    expect(isPersonalOrgLike({ slug: 'personal-user-1', metadata: null })).toBe(true)
    expect(isPersonalOrgLike({ slug: 't1234567890abcdef', metadata: { type: 'team' } })).toBe(false)
    expect(isTeamOrgLike({ slug: 't1234567890abcdef', metadata: { type: 'team' } })).toBe(true)
  })
})
