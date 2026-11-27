import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { getTorrentCacheConfig, replaceTorrentCacheConfig } from '@/lib/api'
import { CreatedKeyDialog } from '../../settings/api-keys'
import { StremThruSettingsPage } from './stremthru'

const state = vi.hoisted(() => ({ role: 'owner', torrentCache: true }))

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

vi.mock('@/lib/auth-client', () => ({
  useSession: () => ({ data: { user: { id: 'user-1', role: 'user' } } }),
  useActiveOrganization: () => ({ data: { id: 'org-1', members: [{ userId: 'user-1', role: state.role }] } }),
}))

vi.mock('@/hooks/useEntitlement', () => ({
  useEntitlement: () => ({ hasFeature: () => state.torrentCache, isLoading: false }),
}))

vi.mock('@/components/UpgradeHint', () => ({
  UpgradeHint: ({ feature }: { feature: string }) => <div>upgrade:{feature}</div>,
}))

vi.mock('@/lib/api', () => ({
  getTorrentCacheConfig: vi.fn(async () => ({ folder: 'Media' })),
  replaceTorrentCacheConfig: vi.fn(async (input: { folder: string }) => ({ folder: input.folder })),
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
  state.role = 'owner'
  state.torrentCache = true
})

function renderPage(node: ReactNode) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })
  return render(<QueryClientProvider client={queryClient}>{node}</QueryClientProvider>)
}

const ADDRESS = `${window.location.origin}/stremthru`

describe('Workspace StremThru settings', () => {
  it('shows the torrent folder, the address, and the MediaFusion token for a new key [spec: torrent-cache/stremthru-settings]', async () => {
    renderPage(<StremThruSettingsPage />)

    const folder = (await screen.findByLabelText('teams.stremthru.folder.label')) as HTMLInputElement
    await waitFor(() => expect(folder.value).toBe('Media'))
    expect(screen.getByTestId('stremthru-address').textContent).toBe(ADDRESS)
    expect(screen.getByText(`teams.stremthru.mediaFusion.token:${ADDRESS}|torbox:<key>`)).toBeTruthy()
    expect(screen.getByText('settings.apiKeys.manage').getAttribute('href')).toBe('/settings/api-keys')

    cleanup()
    renderPage(
      <CreatedKeyDialog createdKey={{ name: 'MediaFusion', key: 'zp_secret', kind: 'stremthru' }} onClose={vi.fn()} />,
    )

    expect(screen.getByTestId('mediafusion-token').textContent).toBe(`${ADDRESS}|torbox:zp_secret`)
    expect(screen.getAllByRole('button', { name: 'settings.apiKeys.copy' })).toHaveLength(2)
  })

  it('lets an admin save the folder and shows it read-only to an editor', async () => {
    renderPage(<StremThruSettingsPage />)
    const folder = (await screen.findByLabelText('teams.stremthru.folder.label')) as HTMLInputElement
    await waitFor(() => expect(folder.value).toBe('Media'))
    const save = screen.getByRole('button', { name: 'teams.stremthru.folder.save' }) as HTMLButtonElement
    expect(save.disabled).toBe(true)

    fireEvent.change(folder, { target: { value: 'Movies/Stremio' } })
    fireEvent.click(save)

    await waitFor(() => expect(replaceTorrentCacheConfig).toHaveBeenCalledWith({ folder: 'Movies/Stremio' }))

    cleanup()
    state.role = 'editor'
    renderPage(<StremThruSettingsPage />)
    const readOnly = (await screen.findByLabelText('teams.stremthru.folder.label')) as HTMLInputElement
    expect(readOnly.disabled).toBe(true)
    expect(screen.getByText('teams.stremthru.folder.readOnly')).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'teams.stremthru.folder.save' })).toBeNull()
  })

  it('shows the upgrade hint instead of the settings without the torrent cache entitlement', () => {
    state.torrentCache = false
    renderPage(<StremThruSettingsPage />)

    expect(screen.getByText('upgrade:torrent_cache')).toBeTruthy()
    expect(screen.queryByTestId('stremthru-address')).toBeNull()
    expect(getTorrentCacheConfig).not.toHaveBeenCalled()
  })

  it('shows no MediaFusion token for other key types', () => {
    renderPage(<CreatedKeyDialog createdKey={{ name: 'CI', key: 'zp_other', kind: 'ihost' }} onClose={vi.fn()} />)

    expect(screen.queryByTestId('mediafusion-token')).toBeNull()
  })
})
