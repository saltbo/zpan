import type { AgentApiKey, AgentOAuthGrant } from '@shared/schemas'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { toast } from 'sonner'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  createAgentApiKey,
  getAgentOAuthConsentContext,
  listAgentApiKeys,
  listAgentOAuthGrants,
  revokeAgentApiKey,
  revokeAgentOAuthGrant,
  rotateAgentApiKey,
  submitAgentOAuthConsent,
} from '@/lib/api'
import { setActive, useListOrganizations } from '@/lib/auth-client'
import { redirectExternal } from '@/lib/browser-navigation'
import { AgentAccessSettingsPage } from './agent-access'
import { SettingsLayout } from './route'

const state = vi.hoisted(() => ({
  orgs: [
    { id: 'org-1', name: 'Personal' },
    { id: 'org-2', name: 'Team Alpha' },
  ],
  keys: [] as AgentApiKey[],
  grants: [] as AgentOAuthGrant[],
  webdavEnabled: true,
}))

const translations: Record<string, string> = {
  'settings.agentAccess.scope.objectsRead': 'Files: read objects',
  'settings.agentAccess.scope.objectsCreate': 'Files: create objects',
  'settings.agentAccess.scope.objectsUpdate': 'Files: update objects',
  'settings.agentAccess.scope.objectsDelete': 'Files: delete objects',
  'settings.agentAccess.scope.sharesRead': 'Shares: read shares',
  'settings.agentAccess.scope.sharesCreate': 'Shares: create shares',
  'settings.agentAccess.scope.sharesDelete': 'Shares: revoke shares',
  'settings.agentAccess.scope.quotaRead': 'Quota: read workspace quota',
  'settings.agentAccess.scope.storageUsageRead': 'Storage usage: read workspace usage',
  'settings.agentAccess.managementRequired': 'Owner or admin access is required',
  'settings.agentAccess.oauthConsentTitle': 'Authorize ZPan Agent',
  'settings.agentAccess.oauthClient': 'Client',
  'settings.agentAccess.oauthOrigin': 'ZPan instance',
  'settings.agentAccess.oauthReturn': 'Return URL',
  'settings.agentAccess.oauthLifetime': 'Grant lifetime',
  'settings.agentAccess.oauthLifetimeValue': '30 days',
  'settings.agentAccess.oauthScopesTitle': 'Requested scopes',
  'settings.agentAccess.oauthApprove': 'Approve Access',
  'settings.agentAccess.oauthDeny': 'Deny',
  'settings.agentAccess.oauthExpiredTitle': 'OAuth request expired',
  'settings.agentAccess.oauthGrantsSection': 'Delegated OAuth Grants',
  'settings.agentAccess.oauthNoGrants': 'No delegated OAuth grants yet',
  'settings.agentAccess.oauthGrantRevokeTitle': 'Revoke OAuth Grant',
  'settings.agentAccess.oauthGrantRevokeSuccess': 'OAuth grant revoked',
}

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => translations[key] ?? key }),
}))

vi.mock('sonner', () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}))

vi.mock('@tanstack/react-router', () => ({
  Outlet: () => <div>outlet</div>,
  createFileRoute: () => (options: unknown) => options,
}))

vi.mock('@/components/layout/page-header', () => ({
  PageHeader: () => <div>page-header</div>,
}))

vi.mock('@/components/layout/page-tabs', () => ({
  PageTabs: ({ items }: { items: Array<{ label: string }> }) => <div>{items.map((item) => item.label).join('|')}</div>,
}))

vi.mock('@/hooks/use-site-config', () => ({
  useSiteConfig: () => ({
    data: { services: { webdav: { enabled: state.webdavEnabled } } },
  }),
}))

vi.mock('@/lib/auth-client', () => ({
  useListOrganizations: vi.fn(),
  setActive: vi.fn(),
}))

vi.mock('@/lib/browser-navigation', () => ({
  redirectExternal: vi.fn(),
}))

vi.mock('@/lib/api', () => ({
  createAgentApiKey: vi.fn(),
  getAgentOAuthConsentContext: vi.fn(),
  listAgentApiKeys: vi.fn(),
  listAgentOAuthGrants: vi.fn(),
  revokeAgentApiKey: vi.fn(),
  revokeAgentOAuthGrant: vi.fn(),
  rotateAgentApiKey: vi.fn(),
  submitAgentOAuthConsent: vi.fn(),
}))

const queryClients: QueryClient[] = []

function renderWithQuery(ui: React.ReactNode) {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  })
  queryClient.setDefaultOptions({
    queries: { retry: false, gcTime: 0 },
    mutations: { retry: false, gcTime: 0 },
  })
  queryClients.push(queryClient)
  return render(<QueryClientProvider client={queryClient}>{ui}</QueryClientProvider>)
}

beforeEach(() => {
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  )
  Element.prototype.scrollIntoView = vi.fn()
  vi.mocked(useListOrganizations).mockReturnValue({ data: state.orgs } as never)
  vi.mocked(listAgentApiKeys).mockImplementation(async (orgId: string) => ({
    items: state.keys.filter((item) => item.orgId === orgId),
    total: state.keys.filter((item) => item.orgId === orgId).length,
    page: 1,
    pageSize: 50,
  }))
  vi.mocked(listAgentOAuthGrants).mockImplementation(async () => ({ items: state.grants }))
  vi.mocked(setActive).mockResolvedValue({ data: null, error: null } as never)
  window.history.replaceState(null, '', '/settings/agent-access')
})

afterEach(() => {
  cleanup()
  for (const queryClient of queryClients.splice(0)) queryClient.clear()
  vi.clearAllMocks()
  vi.unstubAllGlobals()
  state.keys = []
  state.grants = []
  state.webdavEnabled = true
})

describe('Agent Access settings page', () => {
  it('loads the first workspace, fetches its keys, and keeps creation inside a dialog', async () => {
    renderWithQuery(<AgentAccessSettingsPage />)

    await waitFor(() => expect(listAgentApiKeys).toHaveBeenCalledWith('org-1'))
    expect(await screen.findByText('settings.agentAccess.noKeys')).toBeTruthy()
    expect(await screen.findByText('No delegated OAuth grants yet')).toBeTruthy()
    expect(screen.queryByLabelText('settings.agentAccess.nameLabel')).toBeNull()

    fireEvent.click(screen.getByRole('button', { name: 'settings.agentAccess.create' }))

    expect(screen.getByLabelText('settings.agentAccess.nameLabel')).toBeTruthy()
    expect(screen.getByLabelText('settings.agentAccess.expiryLabel')).toBeTruthy()
    for (const label of [
      'Files: read objects',
      'Files: create objects',
      'Files: update objects',
      'Files: delete objects',
      'Shares: read shares',
      'Shares: create shares',
      'Shares: revoke shares',
      'Quota: read workspace quota',
      'Storage usage: read workspace usage',
    ]) {
      expect(screen.getByText(label)).toBeTruthy()
    }
    expect(screen.queryByText(/settings\.agentAccess\.scope\..*:/)).toBeNull()
  })

  it('creates a workspace Agent API key and reveals the secret once', async () => {
    vi.mocked(createAgentApiKey).mockResolvedValue({
      key: 'zpan_agent_secret',
      item: {
        id: 'agent-key-1',
        name: 'CI key',
        orgId: 'org-1',
        workspaceName: 'Personal',
        scopes: ['objects:read'],
        createdAt: '2026-07-29T12:00:00.000Z',
        expiresAt: '2026-10-27T23:59:59.000Z',
        lastUsedAt: null,
        status: 'active',
      },
    })

    renderWithQuery(<AgentAccessSettingsPage />)
    await waitFor(() => expect(listAgentApiKeys).toHaveBeenCalledWith('org-1'))
    await screen.findByText('settings.agentAccess.noKeys')

    fireEvent.click(screen.getByRole('button', { name: 'settings.agentAccess.create' }))
    const dialog = await screen.findByRole('dialog', { name: 'settings.agentAccess.createTitle' })
    fireEvent.change(within(dialog).getByLabelText('settings.agentAccess.nameLabel'), {
      target: { value: '  CI key  ' },
    })
    fireEvent.click(within(dialog).getByRole('button', { name: 'settings.agentAccess.create' }))

    await waitFor(() =>
      expect(createAgentApiKey).toHaveBeenCalledWith(
        'org-1',
        expect.objectContaining({
          name: 'CI key',
          scopes: ['objects:read', 'shares:read', 'quota:read', 'storage-usage:read'],
          expiresAt: expect.stringMatching(/T23:59:59\.000Z$/),
        }),
      ),
    )
    expect(screen.getByText('zpan_agent_secret')).toBeTruthy()
    expect(toast.success).toHaveBeenCalledWith('settings.agentAccess.createSuccess')
  })

  it('rotates and revokes an existing workspace Agent API key', async () => {
    state.keys = [
      {
        id: 'agent-key-1',
        name: 'CI key',
        orgId: 'org-1',
        workspaceName: 'Personal',
        scopes: ['objects:read'],
        createdAt: '2026-07-29T12:00:00.000Z',
        expiresAt: '2026-10-27T23:59:59.000Z',
        lastUsedAt: null,
        status: 'active',
      },
    ]
    vi.mocked(rotateAgentApiKey).mockResolvedValue({
      key: 'zpan_agent_rotated',
      item: {
        ...state.keys[0],
        id: 'agent-key-2',
      },
    })
    vi.mocked(revokeAgentApiKey).mockResolvedValue(undefined)

    renderWithQuery(<AgentAccessSettingsPage />)
    await screen.findByText('CI key')

    fireEvent.click(screen.getByRole('button', { name: 'settings.agentAccess.rotate' }))

    await waitFor(() => expect(rotateAgentApiKey).toHaveBeenCalledWith('org-1', 'agent-key-1'))
    const revealedDialog = await screen.findByRole('dialog', { name: 'settings.agentAccess.revealedTitle' })
    expect(within(revealedDialog).getByText('zpan_agent_rotated')).toBeTruthy()
    expect(toast.success).toHaveBeenCalledWith('settings.agentAccess.rotateSuccess')
    fireEvent.click(within(revealedDialog).getAllByRole('button', { name: 'common.close' })[1]!)
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'settings.agentAccess.revealedTitle' })).toBeNull())

    fireEvent.click(screen.getByRole('button', { name: 'settings.agentAccess.revoke' }))
    const revokeDialog = await screen.findByRole('dialog', { name: 'settings.agentAccess.revokeTitle' })
    fireEvent.click(within(revokeDialog).getByRole('button', { name: 'settings.agentAccess.revoke' }))

    await waitFor(() => expect(revokeAgentApiKey).toHaveBeenCalledWith('org-1', 'agent-key-1'))
    expect(toast.success).toHaveBeenCalledWith('settings.agentAccess.revokeSuccess')
  })

  it('surfaces rotate and revoke errors and lets the revoke dialog close from its close control', async () => {
    state.keys = [
      {
        id: 'agent-key-1',
        name: 'CI key',
        orgId: 'org-1',
        workspaceName: 'Personal',
        scopes: ['objects:read'],
        createdAt: '2026-07-29T12:00:00.000Z',
        expiresAt: '2026-10-27T23:59:59.000Z',
        lastUsedAt: null,
        status: 'active',
      },
    ]
    vi.mocked(rotateAgentApiKey).mockRejectedValue(new Error('rotate failed'))
    vi.mocked(revokeAgentApiKey).mockRejectedValue(new Error('revoke failed'))

    renderWithQuery(<AgentAccessSettingsPage />)
    await screen.findByText('CI key')

    fireEvent.click(screen.getByRole('button', { name: 'settings.agentAccess.rotate' }))
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith('rotate failed'))

    fireEvent.click(screen.getByRole('button', { name: 'settings.agentAccess.revoke' }))
    const revokeDialog = await screen.findByRole('dialog', { name: 'settings.agentAccess.revokeTitle' })
    fireEvent.click(within(revokeDialog).getByRole('button', { name: 'settings.agentAccess.revoke' }))
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith('revoke failed'))

    fireEvent.click(within(revokeDialog).getByRole('button', { name: 'common.close' }))
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'settings.agentAccess.revokeTitle' })).toBeNull())
  })

  it('does not offer rotation for expired or revoked keys', async () => {
    state.keys = [
      {
        id: 'expired-key',
        name: 'Expired key',
        orgId: 'org-1',
        workspaceName: 'Personal',
        scopes: ['objects:read'],
        createdAt: '2026-01-01T00:00:00.000Z',
        expiresAt: '2026-02-01T00:00:00.000Z',
        lastUsedAt: null,
        status: 'expired',
      },
      {
        id: 'revoked-key',
        name: 'Revoked key',
        orgId: 'org-1',
        workspaceName: 'Personal',
        scopes: ['objects:read'],
        createdAt: '2026-01-01T00:00:00.000Z',
        expiresAt: '2026-12-01T00:00:00.000Z',
        lastUsedAt: null,
        status: 'revoked',
      },
    ]

    renderWithQuery(<AgentAccessSettingsPage />)
    await screen.findByText('Expired key')
    expect(screen.getByText('Revoked key')).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'settings.agentAccess.rotate' })).toBeNull()
  })

  it('disables credential creation when the workspace management check fails', async () => {
    vi.mocked(listAgentApiKeys).mockRejectedValue(new Error('Forbidden'))

    renderWithQuery(<AgentAccessSettingsPage />)

    expect(await screen.findByText('Owner or admin access is required')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'settings.agentAccess.create' }).hasAttribute('disabled')).toBe(true)
  })

  it('lists delegated OAuth grants and revokes them server-side', async () => {
    state.grants = [
      {
        id: 'grant-1',
        clientId: 'zpan-agent',
        clientName: 'ZPan Agent',
        userId: 'user-1',
        orgId: 'org-1',
        workspaceName: 'Personal',
        scopes: ['objects:read', 'shares:create'],
        createdAt: '2026-07-29T12:00:00.000Z',
        lastUsedAt: '2026-07-29T12:10:00.000Z',
        status: 'active',
      },
    ]
    vi.mocked(revokeAgentOAuthGrant).mockResolvedValue(undefined)

    renderWithQuery(<AgentAccessSettingsPage />)

    expect(await screen.findByText('Delegated OAuth Grants')).toBeTruthy()
    expect(await screen.findByText('ZPan Agent')).toBeTruthy()
    expect(screen.getByText('Files: read objects')).toBeTruthy()
    expect(screen.getByText('Shares: create shares')).toBeTruthy()

    const revokeButtons = screen.getAllByRole('button', { name: 'settings.agentAccess.revoke' })
    fireEvent.click(revokeButtons[revokeButtons.length - 1]!)
    const dialog = await screen.findByRole('dialog', { name: 'Revoke OAuth Grant' })
    fireEvent.click(within(dialog).getByRole('button', { name: 'settings.agentAccess.revoke' }))

    await waitFor(() => expect(revokeAgentOAuthGrant).toHaveBeenCalledWith('grant-1'))
    expect(toast.success).toHaveBeenCalledWith('OAuth grant revoked')
  })

  it('renders OAuth consent from server context and submits full approval', async () => {
    window.history.replaceState(
      null,
      '',
      '/settings/agent-access?client_id=zpan-agent&redirect_uri=http%3A%2F%2F127.0.0.1%3A8484%2Fcallback&response_type=code&scope=openid%20offline_access%20objects%3Aread%20quota%3Aread',
    )
    vi.mocked(getAgentOAuthConsentContext).mockResolvedValue({
      clientId: 'zpan-agent',
      clientName: 'ZPan Agent',
      instanceOrigin: 'https://zpan.example.test',
      workspace: { id: 'org-1', name: 'Personal' },
      scopes: ['objects:read', 'quota:read'],
      standardScopes: ['openid', 'offline_access'],
      redirectUri: 'http://127.0.0.1:8484/callback',
      grantLifetime: { accessTokenSeconds: 900, refreshTokenSeconds: 2_592_000 },
    })
    vi.mocked(submitAgentOAuthConsent).mockResolvedValue({ url: 'http://127.0.0.1:8484/callback?code=abc' })

    renderWithQuery(<AgentAccessSettingsPage />)

    expect(await screen.findByRole('heading', { name: 'Authorize ZPan Agent' })).toBeTruthy()
    expect(screen.getByText('https://zpan.example.test')).toBeTruthy()
    expect(screen.getByText('http://127.0.0.1:8484/callback')).toBeTruthy()
    expect(screen.getByText('Files: read objects')).toBeTruthy()
    expect(screen.getByText('Quota: read workspace quota')).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: 'Approve Access' }))

    await waitFor(() =>
      expect(submitAgentOAuthConsent).toHaveBeenCalledWith({
        accept: true,
        oauthQuery: window.location.search.slice(1),
      }),
    )
    expect(redirectExternal).toHaveBeenCalledWith('http://127.0.0.1:8484/callback?code=abc')
  })

  it('switches active workspace before OAuth consent and supports denial', async () => {
    window.history.replaceState(
      null,
      '',
      '/settings/agent-access?client_id=zpan-agent&redirect_uri=http%3A%2F%2F127.0.0.1%3A8484%2Fcallback&response_type=code&scope=objects%3Aread',
    )
    vi.mocked(getAgentOAuthConsentContext).mockResolvedValue({
      clientId: 'zpan-agent',
      clientName: 'ZPan Agent',
      instanceOrigin: 'https://zpan.example.test',
      workspace: { id: 'org-1', name: 'Personal' },
      scopes: ['objects:read'],
      standardScopes: [],
      redirectUri: 'http://127.0.0.1:8484/callback',
      grantLifetime: { accessTokenSeconds: 900, refreshTokenSeconds: 2_592_000 },
    })
    vi.mocked(submitAgentOAuthConsent).mockResolvedValue({ url: 'http://127.0.0.1:8484/callback?error=access_denied' })

    renderWithQuery(<AgentAccessSettingsPage />)
    await screen.findByRole('heading', { name: 'Authorize ZPan Agent' })

    fireEvent.click(screen.getByRole('combobox'))
    fireEvent.click(await screen.findByRole('option', { name: 'Team Alpha' }))
    await waitFor(() => expect(setActive).toHaveBeenCalledWith({ organizationId: 'org-2' }))

    fireEvent.click(screen.getByRole('button', { name: 'Deny' }))
    await waitFor(() =>
      expect(submitAgentOAuthConsent).toHaveBeenCalledWith({
        accept: false,
        oauthQuery: window.location.search.slice(1),
      }),
    )
    expect(redirectExternal).toHaveBeenCalledWith('http://127.0.0.1:8484/callback?error=access_denied')
  })

  it('shows an expired OAuth request state when the consent context fails', async () => {
    window.history.replaceState(
      null,
      '',
      '/settings/agent-access?client_id=zpan-agent&redirect_uri=http%3A%2F%2F127.0.0.1%3A8484%2Fcallback',
    )
    vi.mocked(getAgentOAuthConsentContext).mockRejectedValue(new Error('expired'))

    renderWithQuery(<AgentAccessSettingsPage />)

    expect(await screen.findByRole('heading', { name: 'OAuth request expired' })).toBeTruthy()
  })
})

describe('Settings layout tabs', () => {
  it('includes the Agent Access tab alongside existing settings tabs', () => {
    renderWithQuery(<SettingsLayout />)

    expect(screen.getByText(/settings\.tabApiKeys\|settings\.tabAgentAccess/)).toBeTruthy()
  })

  it('keeps the Agent Access tab when WebDAV is disabled', () => {
    state.webdavEnabled = false

    renderWithQuery(<SettingsLayout />)

    expect(screen.getByText(/settings\.tabApiKeys\|settings\.tabAgentAccess/)).toBeTruthy()
    expect(screen.queryByText(/settings\.tabWebDav/)).toBeNull()
  })
})
