import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { groupOAuthScopes, OAuthScopeList } from './oauth-scope-list'

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => key,
    i18n: { language: 'zh', resolvedLanguage: 'zh' },
  }),
}))

afterEach(cleanup)

describe('OAuthScopeList', () => {
  it('groups scopes by resource without changing their raw values', () => {
    expect(groupOAuthScopes(['openid', 'objects:read', 'objects:create', 'shares:read'])).toEqual([
      { id: 'oauth', scopes: ['openid'] },
      { id: 'objects', scopes: ['objects:read', 'objects:create'] },
      { id: 'shares', scopes: ['shares:read'] },
    ])
  })

  it('shows each raw scope together with its localized description', () => {
    render(<OAuthScopeList scopes={['objects:read']} />)

    expect(screen.getByText('objects:read')).toBeTruthy()
    expect(screen.getByText('列出、查看和下载文件')).toBeTruthy()
  })

  it('marks missing descriptions explicitly instead of generating copy', () => {
    render(<OAuthScopeList scopes={['future:scope']} />)

    expect(screen.getByText('future:scope')).toBeTruthy()
    expect(screen.getByText('settings.oauthApps.scopeDescriptionMissing')).toBeTruthy()
  })
})
