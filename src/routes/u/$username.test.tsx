import type { PublicProfile } from '@shared/schemas/profile'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { getProfile } from '@/lib/api'
import { ProfilePage } from './$username'

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}))

vi.mock('@tanstack/react-router', () => ({
  createFileRoute: () => (options: object) => ({
    ...options,
    useParams: () => ({ username: 'alice' }),
  }),
}))

vi.mock('@/lib/api', () => ({
  getProfile: vi.fn(),
}))

const profile: PublicProfile = {
  user: {
    username: 'alice',
    name: 'Alice',
    image: null,
  },
  shares: [
    {
      token: 'file-token',
      name: 'release-notes.pdf',
      type: 'application/pdf',
      size: 1024,
      isFolder: false,
    },
    {
      token: 'folder-token',
      name: 'Public folder',
      type: 'folder',
      size: null,
      isFolder: true,
    },
  ],
}

function renderPage() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={queryClient}>
      <ProfilePage />
    </QueryClientProvider>,
  )
}

beforeEach(() => {
  vi.mocked(getProfile).mockResolvedValue(profile)
})

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

describe('public user homepage', () => {
  it('loads the requested profile and links curated files and folders to the landing-share flow', async () => {
    renderPage()

    expect(await screen.findByText('Alice')).toBeTruthy()
    expect(getProfile).toHaveBeenCalledWith('alice')
    expect(screen.getByRole('link', { name: /release-notes\.pdf/ }).getAttribute('href')).toBe('/s/file-token')
    expect(screen.getByRole('link', { name: /Public folder/ }).getAttribute('href')).toBe('/s/folder-token')
    expect(screen.queryByText('profile.noShares')).toBeNull()
  })

  it('shows the empty state when the profile has no curated shares', async () => {
    vi.mocked(getProfile).mockResolvedValue({ ...profile, shares: [] })

    renderPage()

    expect(await screen.findByText('profile.noShares')).toBeTruthy()
    expect(screen.queryByRole('link')).toBeNull()
  })
})
