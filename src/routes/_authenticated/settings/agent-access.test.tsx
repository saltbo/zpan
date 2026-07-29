import type { AgentApiKey } from '@shared/schemas'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { toast } from 'sonner'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createAgentApiKey, listAgentApiKeys, revokeAgentApiKey, rotateAgentApiKey } from '@/lib/api'
import { useListOrganizations } from '@/lib/auth-client'
import { AgentAccessSettingsPage } from './agent-access'
import { SettingsLayout } from './route'

const state = vi.hoisted(() => ({
  orgs: [
    { id: 'org-1', name: 'Personal' },
    { id: 'org-2', name: 'Team Alpha' },
  ],
  keys: [] as AgentApiKey[],
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
}))

vi.mock('@/lib/api', () => ({
  createAgentApiKey: vi.fn(),
  listAgentApiKeys: vi.fn(),
  revokeAgentApiKey: vi.fn(),
  rotateAgentApiKey: vi.fn(),
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
  vi.mocked(useListOrganizations).mockReturnValue({ data: state.orgs } as never)
  vi.mocked(listAgentApiKeys).mockImplementation(async (orgId: string) => ({
    items: state.keys.filter((item) => item.orgId === orgId),
    total: state.keys.filter((item) => item.orgId === orgId).length,
    page: 1,
    pageSize: 50,
  }))
})

afterEach(() => {
  cleanup()
  for (const queryClient of queryClients.splice(0)) queryClient.clear()
  vi.clearAllMocks()
  vi.unstubAllGlobals()
  state.keys = []
  state.webdavEnabled = true
})

describe('Agent Access settings page', () => {
  it('loads the first workspace, fetches its keys, and keeps creation inside a dialog', async () => {
    renderWithQuery(<AgentAccessSettingsPage />)

    await waitFor(() => expect(listAgentApiKeys).toHaveBeenCalledWith('org-1'))
    expect(await screen.findByText('settings.agentAccess.noKeys')).toBeTruthy()
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
