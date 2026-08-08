import type { AuditEvent } from '@shared/types'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, render, screen } from '@testing-library/react'
import type * as React from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
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

afterEach(() => {
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
    vi.mocked(listTeamActivities).mockResolvedValue({ items: [event], total: 1, page: 1, pageSize: 20 })
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
