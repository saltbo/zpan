import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, render, screen } from '@testing-library/react'
import type { ReactNode } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { CreatedKeyDialog } from '../../settings/api-keys'
import { StremThruSettingsPage } from './stremthru'

const state = vi.hoisted(() => ({ torrents: true }))

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, values?: { token?: string }) => (values?.token ? `${key}:${values.token}` : key),
  }),
}))

vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }))

vi.mock('@tanstack/react-router', () => ({
  createFileRoute: () => (options: unknown) => options,
  Link: ({ children, to }: { children: ReactNode; to: string }) => <a href={to}>{children}</a>,
}))

vi.mock('@/hooks/useEntitlement', () => ({
  useEntitlement: () => ({ hasFeature: () => state.torrents, isLoading: false }),
}))

vi.mock('@/components/UpgradeHint', () => ({
  UpgradeHint: ({ feature }: { feature: string }) => <div>upgrade:{feature}</div>,
}))

vi.mock('@/lib/api', () => ({
  createIhostApiKey: vi.fn(),
  createRemoteDownloadApiKey: vi.fn(),
  createStremThruApiKey: vi.fn(),
  createWebDavAppPassword: vi.fn(),
  listApiKeys: vi.fn(),
  revokeIhostApiKey: vi.fn(),
  revokeRemoteDownloadApiKey: vi.fn(),
  revokeStremThruApiKey: vi.fn(),
  revokeWebDavAppPassword: vi.fn(),
}))

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
  state.torrents = true
})

function renderPage(node: ReactNode) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })
  return render(<QueryClientProvider client={queryClient}>{node}</QueryClientProvider>)
}

const ADDRESS = `${window.location.origin}/stremthru`

describe('Workspace StremThru settings', () => {
  it('shows the address and the MediaFusion token for a new key [spec: torrents/stremthru-settings]', () => {
    renderPage(<StremThruSettingsPage />)

    expect(screen.getByTestId('stremthru-address').textContent).toBe(ADDRESS)
    expect(screen.queryByLabelText('teams.stremthru.folder.label')).toBeNull()
    expect(screen.getByText(`teams.stremthru.mediaFusion.token:${ADDRESS}|torbox:<key>`)).toBeTruthy()
    expect(screen.getByText('settings.apiKeys.manage').getAttribute('href')).toBe('/settings/api-keys')

    cleanup()
    renderPage(
      <CreatedKeyDialog createdKey={{ name: 'MediaFusion', key: 'zp_secret', kind: 'stremthru' }} onClose={vi.fn()} />,
    )

    expect(screen.getByTestId('mediafusion-token').textContent).toBe(`${ADDRESS}|torbox:zp_secret`)
    expect(screen.getAllByRole('button', { name: 'settings.apiKeys.copy' })).toHaveLength(2)
  })

  it('shows the upgrade hint instead of the settings without the torrents entitlement', () => {
    state.torrents = false
    renderPage(<StremThruSettingsPage />)

    expect(screen.getByText('upgrade:torrents')).toBeTruthy()
    expect(screen.queryByTestId('stremthru-address')).toBeNull()
  })

  it('shows no MediaFusion token for other key types', () => {
    renderPage(<CreatedKeyDialog createdKey={{ name: 'CI', key: 'zp_other', kind: 'ihost' }} onClose={vi.fn()} />)

    expect(screen.queryByTestId('mediafusion-token')).toBeNull()
  })
})
