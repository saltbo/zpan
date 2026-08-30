import { AuthorizationScope } from '@shared/authorization'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { OAuthGrants } from './oauth-apps'

const api = vi.hoisted(() => ({
  listOAuthGrants: vi.fn(),
  revokeOAuthGrant: vi.fn(),
}))

vi.mock('@tanstack/react-router', () => ({
  createFileRoute: () => (options: unknown) => options,
}))

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, values?: { count?: number }) =>
      key === 'settings.oauthApps.permissionCount' ? `${values?.count} permissions` : key,
    i18n: { language: 'en', resolvedLanguage: 'en' },
  }),
}))

vi.mock('@/lib/api', () => api)

const grant = {
  id: 'Grant1234567890123456',
  clientId: 'Client123456789012345',
  clientName: 'Realmroot ZPan',
  userId: 'User12345678901234567',
  workspaces: [{ id: 'Space1234567890123456', name: "Ambor's Space" }],
  scopes: [AuthorizationScope.OBJECTS_READ, AuthorizationScope.OBJECTS_CREATE],
  createdAt: '2026-08-12T04:37:20.000Z',
  lastUsedAt: null,
  status: 'active' as const,
}

function renderPage() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={queryClient}>
      <OAuthGrants />
    </QueryClientProvider>,
  )
}

beforeEach(() => {
  api.listOAuthGrants.mockResolvedValue({ items: [grant] })
  api.revokeOAuthGrant.mockResolvedValue(undefined)
})

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

describe('OAuth grants settings', () => {
  it('keeps large scope sets out of the table and opens details in a right sheet', async () => {
    renderPage()

    expect(await screen.findByText('Realmroot ZPan')).toBeTruthy()
    expect(screen.getByText('2 permissions')).toBeTruthy()
    expect(screen.queryByText(AuthorizationScope.OBJECTS_READ)).toBeNull()

    fireEvent.click(screen.getByRole('button', { name: 'settings.oauthApps.viewDetails' }))

    expect(await screen.findByText('Client123456789012345')).toBeTruthy()
    expect(screen.getByText(AuthorizationScope.OBJECTS_READ)).toBeTruthy()
    expect(screen.getByText('List, inspect, and download objects')).toBeTruthy()
  })

  it('keeps revoke inside the details flow and confirms before calling the API', async () => {
    renderPage()

    fireEvent.click(await screen.findByRole('button', { name: 'settings.oauthApps.viewDetails' }))
    fireEvent.click(await screen.findByRole('button', { name: 'settings.oauthApps.revokeAccess' }))

    expect(screen.getByText('settings.oauthApps.oauthGrantRevokeTitle')).toBeTruthy()
    const revokeButtons = screen.getAllByRole('button', { name: 'settings.oauthApps.revokeAccess' })
    fireEvent.click(revokeButtons.at(-1)!)

    await waitFor(() => expect(api.revokeOAuthGrant).toHaveBeenCalledWith(grant.id))
  })
})
