import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { grantUserEntitlement, updateOrgEntitlement } from '@/lib/api'
import { GrantEntitlementDialog } from './grant-entitlement-dialog'

class TestResizeObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
}

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, values?: Record<string, string>) => {
      if (!values) return key
      return Object.entries(values).reduce((message, [name, value]) => message.replace(`{{${name}}}`, value), key)
    },
  }),
}))

vi.mock('sonner', () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
  },
}))

vi.mock('@/lib/api', () => ({
  grantOrgEntitlement: vi.fn(),
  grantUserEntitlement: vi.fn(),
  updateOrgEntitlement: vi.fn(),
  updateUserEntitlement: vi.fn(),
}))

function renderGrantEntitlementDialog(props: Partial<Parameters<typeof GrantEntitlementDialog>[0]> = {}) {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  })
  const invalidateQueries = vi.spyOn(queryClient, 'invalidateQueries')
  const onOpenChange = vi.fn()

  render(
    <QueryClientProvider client={queryClient}>
      <GrantEntitlementDialog
        open
        onOpenChange={onOpenChange}
        target={{ kind: 'user', id: 'user-1', name: 'Ava' }}
        {...props}
      />
    </QueryClientProvider>,
  )

  return { invalidateQueries, onOpenChange }
}

beforeEach(() => {
  vi.stubGlobal('ResizeObserver', TestResizeObserver)
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  vi.clearAllMocks()
})

describe('GrantEntitlementDialog', () => {
  it('grants user storage quota and invalidates user admin queries', async () => {
    vi.mocked(grantUserEntitlement).mockResolvedValue({} as Awaited<ReturnType<typeof grantUserEntitlement>>)
    const { invalidateQueries, onOpenChange } = renderGrantEntitlementDialog()

    fireEvent.change(screen.getByLabelText('admin.entitlement.amount'), { target: { value: '5' } })
    fireEvent.click(screen.getByRole('button', { name: 'admin.entitlement.grant' }))

    await waitFor(() =>
      expect(grantUserEntitlement).toHaveBeenCalledWith('user-1', {
        resourceType: 'storage',
        bytes: 5 * 1024 * 1024 * 1024,
        expiresAt: null,
        note: null,
      }),
    )
    expect(invalidateQueries).toHaveBeenCalledWith({ queryKey: ['admin', 'users'] })
    expect(invalidateQueries).toHaveBeenCalledWith({ queryKey: ['admin', 'users', 'user-1'] })
    expect(invalidateQueries).toHaveBeenCalledWith({ queryKey: ['admin', 'users', 'user-1', 'entitlements'] })
    expect(onOpenChange).toHaveBeenCalledWith(false)
  })

  it('prefills and updates a team entitlement from editable metadata', async () => {
    vi.mocked(updateOrgEntitlement).mockResolvedValue({} as Awaited<ReturnType<typeof updateOrgEntitlement>>)
    const { invalidateQueries } = renderGrantEntitlementDialog({
      target: { kind: 'team', orgId: 'team-1', name: 'Core Team' },
      entitlement: {
        id: 'entitlement-1',
        bytes: 2 * 1024 * 1024 * 1024,
        expiresAt: null,
        metadata: JSON.stringify({ note: 'Initial grant' }),
      },
    })

    expect(screen.getByLabelText('admin.entitlement.amount')).toHaveProperty('value', '2')
    expect(screen.getByLabelText('admin.entitlement.note')).toHaveProperty('value', 'Initial grant')

    fireEvent.change(screen.getByLabelText('admin.entitlement.amount'), { target: { value: '3' } })
    fireEvent.change(screen.getByLabelText('admin.entitlement.note'), { target: { value: 'Expansion' } })
    fireEvent.click(screen.getByRole('button', { name: 'admin.entitlement.save' }))

    await waitFor(() =>
      expect(updateOrgEntitlement).toHaveBeenCalledWith('team-1', 'entitlement-1', {
        bytes: 3 * 1024 * 1024 * 1024,
        expiresAt: null,
        note: 'Expansion',
      }),
    )
    expect(invalidateQueries).toHaveBeenCalledWith({ queryKey: ['admin', 'teams'] })
    expect(invalidateQueries).toHaveBeenCalledWith({ queryKey: ['admin', 'teams', 'team-1', 'entitlements'] })
  })
})
