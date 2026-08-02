import { describe, expect, it } from 'vitest'
import { WORKSPACE_AUTHORIZATION_DETAIL_TYPE } from '../oauth'
import { parseWorkspaceAuthorizationDetails } from './oauth-authorization'

describe('parseWorkspaceAuthorizationDetails', () => {
  it('rejects unknown authorization-detail members', () => {
    expect(() =>
      parseWorkspaceAuthorizationDetails([
        { type: WORKSPACE_AUTHORIZATION_DETAIL_TYPE, identifier: 'workspace-1', unexpected: true },
      ]),
    ).toThrow()
  })
})
