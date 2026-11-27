import type { AuditEvent } from '@shared/types'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, cleanup, render, screen, waitFor } from '@testing-library/react'
import type * as React from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { listTeamActivities } from '@/lib/api'
import { Route } from './activity'

vi.mock('@tanstack/react-router', () => ({
  createFileRoute: () => (options: object) => ({ ...options, useParams: () => ({ teamId: 'team-1' }) }),
}))

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, values?: { defaultValue?: string }) => values?.defaultValue ?? key,
  }),
}))

vi.mock('@/lib/api', () => ({ listTeamActivities: vi.fn() }))

type ActivityRoute = typeof Route & { component: React.ComponentType }

class IntersectionObserverStub {
  static instances: IntersectionObserverStub[] = []
  readonly observe = vi.fn()
  readonly disconnect = vi.fn()

  constructor(readonly callback: IntersectionObserverCallback) {
    IntersectionObserverStub.instances.push(this)
  }

  intersect() {
    this.callback([{ isIntersecting: true } as IntersectionObserverEntry], this as unknown as IntersectionObserver)
  }

  static get live() {
    return IntersectionObserverStub.instances.filter((instance) => instance.disconnect.mock.calls.length === 0)
  }
}

beforeEach(() => {
  IntersectionObserverStub.instances = []
  vi.stubGlobal('IntersectionObserver', IntersectionObserverStub)
})

afterEach(() => {
  vi.unstubAllGlobals()
  cleanup()
  vi.clearAllMocks()
})

describe('TeamActivityPage actors', () => {
  it('shows the resolved Agent identity instead of the delegated user', async () => {
    const event = auditEvent({
      actorType: 'oauth',
      actorRef: 'agt_1',
      actorIssuer: 'https://id.realmroot.dev/api/auth',
      actor: {
        name: 'Mac Agent',
        image: 'https://id.realmroot.dev/agent-picture-v1.svg',
        resolved: true,
      },
    })
    vi.mocked(listTeamActivities).mockResolvedValue({ items: [event], nextPageToken: null })
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    const Component = (Route as ActivityRoute).component

    render(
      <QueryClientProvider client={queryClient}>
        <Component />
      </QueryClientProvider>,
    )

    expect(await screen.findByText('Mac Agent')).toBeTruthy()
    expect(screen.queryByText('Ambor')).toBeNull()
  })
})

describe('TeamActivityPage infinite scroll', () => {
  it('appends the next page with the previous token when the end is reached, with no Load more button', async () => {
    vi.mocked(listTeamActivities).mockImplementation(async (_teamId, opts) =>
      opts?.pageToken === 'tok-2'
        ? { items: [auditEvent({ id: 'audit-2', targetName: 'second.txt' })], nextPageToken: null }
        : { items: [auditEvent({ id: 'audit-1', targetName: 'first.txt' })], nextPageToken: 'tok-2' },
    )
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    const Component = (Route as ActivityRoute).component

    render(
      <QueryClientProvider client={queryClient}>
        <Component />
      </QueryClientProvider>,
    )

    expect(await screen.findByText(/first\.txt/)).toBeTruthy()
    expect(screen.queryByRole('button')).toBeNull()
    expect(listTeamActivities).toHaveBeenCalledTimes(1)
    expect(listTeamActivities).toHaveBeenCalledWith('team-1', { pageToken: undefined, pageSize: 20 })

    await waitFor(() => expect(IntersectionObserverStub.live).toHaveLength(1))
    act(() => IntersectionObserverStub.live[0].intersect())

    expect(await screen.findByText(/second\.txt/)).toBeTruthy()
    expect(screen.getByText(/first\.txt/)).toBeTruthy()
    expect(listTeamActivities).toHaveBeenLastCalledWith('team-1', { pageToken: 'tok-2', pageSize: 20 })
    await waitFor(() => expect(IntersectionObserverStub.live).toHaveLength(0))
    expect(listTeamActivities).toHaveBeenCalledTimes(2)
  })
})

function auditEvent(overrides: Partial<AuditEvent> = {}): AuditEvent {
  return {
    id: 'audit-1',
    orgId: 'team-1',
    userId: 'user-1',
    actorType: 'user',
    actorRef: null,
    actorIssuer: null,
    action: 'upload',
    targetType: 'file',
    targetId: 'file-1',
    targetName: 'agent.txt',
    metadata: null,
    createdAt: '2026-08-08T02:00:00.000Z',
    user: { id: 'user-1', name: 'Ambor', image: null },
    actor: { name: 'Ambor', image: null, resolved: true },
    ...overrides,
  }
}
