import { CANONICAL_AUTHORIZATION_SCOPES } from '@shared/authorization'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { OAuthConsentPage } from './consent'

const api = vi.hoisted(() => ({
  getOAuthConsentContext: vi.fn(),
  submitOAuthConsent: vi.fn(),
}))

vi.mock('@tanstack/react-router', () => ({
  createFileRoute: () => (options: unknown) => options,
}))

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, values?: { count?: number; client?: string; days?: number; origin?: string }) => {
      if (key === 'settings.oauthApps.permissionCount') return `${values?.count} permissions`
      if (key === 'settings.oauthApps.oauthWantsAccess') return `${values?.client} wants access`
      return key
    },
    i18n: { language: 'en', resolvedLanguage: 'en' },
  }),
}))

vi.mock('@/hooks/use-site-config', () => ({
  useSiteConfig: () => ({ data: { site: { name: 'ZPan' } } }),
}))

vi.mock('@/lib/api', () => api)
vi.mock('@/lib/browser-navigation', () => ({ redirectExternal: vi.fn() }))

function renderPage() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={queryClient}>
      <OAuthConsentPage />
    </QueryClientProvider>,
  )
}

beforeEach(() => {
  window.history.replaceState({}, '', '/oauth/consent?request=example')
  api.getOAuthConsentContext.mockResolvedValue({
    clientId: 'Client123456789012345',
    clientName: 'Realmroot ZPan',
    clientOrigin: 'https://id.realmroot.dev',
    workspaces: [{ id: 'Space1234567890123456', name: "Ambor's Space" }],
    requestedWorkspaceIds: ['Space1234567890123456'],
    scopes: CANONICAL_AUTHORIZATION_SCOPES,
    standardScopes: ['openid', 'offline_access'],
    redirectUri: 'https://id.realmroot.dev/oauth/callback',
    grantLifetime: { accessTokenSeconds: 900, refreshTokenSeconds: 2592000 },
  })
})

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
  window.history.replaceState({}, '', '/')
})

describe('OAuth consent permissions', () => {
  it('renders a large permission request as grouped raw scopes with descriptions', async () => {
    renderPage()

    expect(await screen.findByText('Realmroot ZPan wants access')).toBeTruthy()
    expect(screen.getByText(`${CANONICAL_AUTHORIZATION_SCOPES.length + 2} permissions`)).toBeTruthy()
    expect(screen.getByText('objects:read')).toBeTruthy()
    expect(screen.getByText('List, inspect, and download objects')).toBeTruthy()
    expect(screen.getByText('offline_access')).toBeTruthy()
    expect(screen.getByText('Keep access while you are away')).toBeTruthy()
  })
})
