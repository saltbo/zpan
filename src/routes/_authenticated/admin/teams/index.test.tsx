import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import type * as React from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { listTeams, type TeamSummary } from '@/lib/api'
import { Route } from './index'

const mocks = vi.hoisted(() => ({ navigate: vi.fn() }))

vi.mock('@tanstack/react-router', () => ({
  createFileRoute: () => (options: object) => options,
  useNavigate: () => mocks.navigate,
}))

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}))

vi.mock('@/lib/api', () => ({ listTeams: vi.fn() }))

type TeamsRoute = typeof Route & { component: React.ComponentType }

function team(id: string, name: string): TeamSummary {
  return {
    id,
    name,
    slug: id,
    logo: null,
    memberCount: 2,
    ownerName: 'Owner',
    quotaUsed: 10,
    quotaTotal: 100,
    createdAt: 1_700_000_000_000,
  }
}

function renderTeamsPage() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const Component = (Route as TeamsRoute).component
  return render(
    <QueryClientProvider client={queryClient}>
      <Component />
    </QueryClientProvider>,
  )
}

const button = (name: string) => screen.getByRole('button', { name }) as HTMLButtonElement

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

describe('Admin teams page', () => {
  it('pages with the previous response token, with no count or page number', async () => {
    vi.mocked(listTeams).mockImplementation(async (opts) =>
      opts?.pageToken === 'tok-2'
        ? { items: [team('team-2', 'Beta')], nextPageToken: null }
        : { items: [team('team-1', 'Alpha')], nextPageToken: 'tok-2' },
    )

    renderTeamsPage()

    expect(await screen.findByText('Alpha')).toBeTruthy()
    expect(listTeams).toHaveBeenCalledWith({ pageToken: undefined, pageSize: 20 })
    expect(button('common.previousPage').disabled).toBe(true)
    expect(screen.queryByText('admin.teams.count')).toBeNull()

    fireEvent.click(button('common.nextPage'))
    expect(await screen.findByText('Beta')).toBeTruthy()
    expect(listTeams).toHaveBeenLastCalledWith({ pageToken: 'tok-2', pageSize: 20 })
    await waitFor(() => expect(button('common.nextPage').disabled).toBe(true))

    fireEvent.click(button('common.previousPage'))
    expect(await screen.findByText('Alpha')).toBeTruthy()
    expect(screen.queryByText('Beta')).toBeNull()
  })

  it('shows the empty state with both buttons disabled', async () => {
    vi.mocked(listTeams).mockResolvedValue({ items: [], nextPageToken: null })

    renderTeamsPage()

    expect(await screen.findByText('admin.teams.noTeams')).toBeTruthy()
    expect(button('common.previousPage').disabled).toBe(true)
    expect(button('common.nextPage').disabled).toBe(true)
  })

  it('opens a team from its row', async () => {
    vi.mocked(listTeams).mockResolvedValue({ items: [team('team-1', 'Alpha')], nextPageToken: null })

    renderTeamsPage()
    fireEvent.click(await screen.findByText('Alpha'))

    expect(mocks.navigate).toHaveBeenCalledWith({ to: '/admin/teams/$orgId', params: { orgId: 'team-1' } })
  })
})
