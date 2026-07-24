import type { ShareView } from '@shared/types'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ApiError, getShareReadme } from '@/lib/api'
import { useSession } from '@/lib/auth-client'
import { ShareLanding } from './share-landing'

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}))

vi.mock('@tanstack/react-router', () => ({
  Link: ({
    to,
    params,
    children,
    ...props
  }: {
    to: string
    params: { username: string }
    children: React.ReactNode
  }) => (
    <a href={to.replace('$username', params.username)} {...props}>
      {children}
    </a>
  ),
}))

vi.mock('@/lib/auth-client', () => ({
  useSession: vi.fn(),
}))

vi.mock('@/lib/api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/api')>()),
  getShareReadme: vi.fn(),
}))

vi.mock('@/components/files/file-manager', () => ({
  FileManager: () => <div>folder-browser</div>,
}))

vi.mock('./file-preview', () => ({
  FilePreview: () => <div>file-preview</div>,
}))

vi.mock('./save-to-drive-dialog', () => ({
  SaveToDriveDialog: ({ open }: { open: boolean }) => (open ? <div>save-dialog</div> : null),
}))

const share: ShareView = {
  token: 'share-token',
  kind: 'landing',
  status: 'active',
  expiresAt: null,
  downloadLimit: null,
  matter: { name: 'roadmap.pdf', type: 'application/pdf', size: 1024, isFolder: false },
  creatorName: 'Alice',
  creatorUsername: 'alice',
  requiresPassword: false,
  expired: false,
  exhausted: false,
  accessibleByUser: false,
  downloads: 12,
  views: 20,
  rootRef: 'root-ref',
}

const folderShare: ShareView = {
  ...share,
  matter: { name: 'Docs', type: 'folder', size: 0, isFolder: true },
}

const notFoundError = new ApiError(404, {
  error: {
    code: 404,
    message: 'README.md not found',
    status: 'NOT_FOUND',
  },
})

beforeEach(() => {
  vi.mocked(useSession).mockReturnValue({ data: null } as ReturnType<typeof useSession>)
  vi.mocked(getShareReadme).mockResolvedValue({ content: '# Folder guide\n\nWelcome.' })
})

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

describe('public share landing', () => {
  function renderLanding(value: ShareView = share) {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    return render(
      <QueryClientProvider client={queryClient}>
        <ShareLanding token={value.token} share={value} />
      </QueryClientProvider>,
    )
  }

  it('links the creator profile and shows download for an anonymous visitor', () => {
    renderLanding()

    expect(screen.getAllByRole('link', { name: 'Alice' })[0].getAttribute('href')).toBe('/u/alice')
    expect(screen.getByRole('link', { name: /share.downloadFile/ }).getAttribute('href')).toContain(
      '/api/shares/share-token/objects/root-ref',
    )
    expect(screen.queryByRole('button', { name: /share.saveToDrive/ })).toBeNull()
  })

  it('does not invent a profile URL when the creator has no username', () => {
    renderLanding({ ...share, creatorUsername: null })

    expect(screen.queryByRole('link', { name: 'Alice' })).toBeNull()
    expect(screen.getAllByText('Alice')).toHaveLength(2)
  })

  it('preserves Save to Drive for signed-in visitors', () => {
    vi.mocked(useSession).mockReturnValue({ data: { user: { id: 'user-1' } } } as ReturnType<typeof useSession>)
    renderLanding()

    fireEvent.click(screen.getByRole('button', { name: /share.saveToDrive/ }))
    expect(screen.getByText('save-dialog')).toBeTruthy()
  })

  it('replaces share information with the rendered root README for folders', async () => {
    renderLanding(folderShare)

    expect(await screen.findByRole('heading', { name: 'Folder guide' })).toBeTruthy()
    expect(screen.getByText('Welcome.')).toBeTruthy()
    expect(screen.queryByText('share.information')).toBeNull()
    expect(getShareReadme).toHaveBeenCalledWith('share-token')
  })

  it('hides the README region from other visitors when the folder has no README', async () => {
    vi.mocked(getShareReadme).mockRejectedValue(notFoundError)
    renderLanding(folderShare)

    await waitFor(() => expect(getShareReadme).toHaveBeenCalledWith('share-token'))
    expect(screen.queryByRole('heading', { name: 'README.md' })).toBeNull()
    expect(screen.queryByText('share.readmeOwnerHint')).toBeNull()
  })

  it('prompts the creator to add a README when the folder has none', async () => {
    vi.mocked(useSession).mockReturnValue({
      data: { user: { id: 'creator-1' } },
    } as ReturnType<typeof useSession>)
    vi.mocked(getShareReadme).mockRejectedValue(notFoundError)

    renderLanding({ ...folderShare, creatorId: 'creator-1' })

    expect(await screen.findByText('share.readmeOwnerHint')).toBeTruthy()
    expect(screen.getByRole('heading', { name: 'README.md' })).toBeTruthy()
  })
})
