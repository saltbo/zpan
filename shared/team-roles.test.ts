import { describe, expect, it } from 'vitest'
import { teamRoleAtLeast } from './team-roles'

describe('teamRoleAtLeast', () => {
  it('orders roles from viewer to owner', () => {
    expect(teamRoleAtLeast('owner', 'editor')).toBe(true)
    expect(teamRoleAtLeast('admin', 'owner')).toBe(true)
    expect(teamRoleAtLeast('editor', 'editor')).toBe(true)
    expect(teamRoleAtLeast('viewer', 'editor')).toBe(false)
    expect(teamRoleAtLeast('member', 'viewer')).toBe(true)
  })

  it('grants nothing to an unknown or missing role', () => {
    expect(teamRoleAtLeast('guest', 'viewer')).toBe(false)
    expect(teamRoleAtLeast(undefined, 'viewer')).toBe(false)
    expect(teamRoleAtLeast(null, 'viewer')).toBe(false)
  })
})
