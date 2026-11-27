import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { grantUserEntitlement, updateOrgEntitlement } from '@/lib/api'
import { bytesToAmountUnit, GrantEntitlementDrawer } from './grant-entitlement-drawer'

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

function renderGrantEntitlementDrawer(props: Partial<Parameters<typeof GrantEntitlementDrawer>[0]> = {}) {
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
      <GrantEntitlementDrawer
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
  Element.prototype.scrollIntoView = vi.fn()
  HTMLElement.prototype.hasPointerCapture = vi.fn(() => false)
  HTMLElement.prototype.setPointerCapture = vi.fn()
  HTMLElement.prototype.releasePointerCapture = vi.fn()
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  vi.clearAllMocks()
})

describe('GrantEntitlementDrawer', () => {
  it('grants user storage quota and invalidates user admin queries', async () => {
    vi.mocked(grantUserEntitlement).mockResolvedValue({} as Awaited<ReturnType<typeof grantUserEntitlement>>)
    const { invalidateQueries, onOpenChange } = renderGrantEntitlementDrawer()

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
    const { invalidateQueries } = renderGrantEntitlementDrawer({
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

  it('shows the amount as one labelled control with a unit suffix selector', () => {
    renderGrantEntitlementDrawer()

    const amount = screen.getByLabelText('admin.entitlement.amount')
    const control = amount.parentElement as HTMLElement
    expect(within(control).getByRole('combobox')).toHaveProperty('textContent', 'GB')
    expect(screen.queryByText('admin.entitlement.unit')).toBeNull()
  })

  it('submits the same bytes for a fractional amount in the chosen unit', async () => {
    vi.mocked(grantUserEntitlement).mockResolvedValue({} as Awaited<ReturnType<typeof grantUserEntitlement>>)
    const user = userEvent.setup()
    renderGrantEntitlementDrawer()

    fireEvent.change(screen.getByLabelText('admin.entitlement.amount'), { target: { value: '1.5' } })
    await user.click(screen.getByRole('combobox'))
    await user.click(await screen.findByRole('option', { name: 'TB' }))
    fireEvent.click(screen.getByRole('button', { name: 'admin.entitlement.grant' }))

    await waitFor(() =>
      expect(grantUserEntitlement).toHaveBeenCalledWith('user-1', {
        resourceType: 'storage',
        bytes: Math.round(1.5 * 1024 ** 4),
        expiresAt: null,
        note: null,
      }),
    )
  })

  it('prefills the amount in the largest whole unit when editing', () => {
    renderGrantEntitlementDrawer({
      entitlement: { id: 'entitlement-1', bytes: 512 * 1024 ** 2, expiresAt: null, metadata: null },
    })

    expect(screen.getByLabelText('admin.entitlement.amount')).toHaveProperty('value', '512')
    expect(screen.getByRole('combobox')).toHaveProperty('textContent', 'MB')
  })

  it('prefills a fractional amount in the unit that reads naturally when editing', () => {
    renderGrantEntitlementDrawer({
      entitlement: { id: 'entitlement-1', bytes: 1572864, expiresAt: null, metadata: null },
    })

    expect(screen.getByLabelText('admin.entitlement.amount')).toHaveProperty('value', '1.5')
    expect(screen.getByRole('combobox')).toHaveProperty('textContent', 'MB')
  })
})

describe('bytesToAmountUnit', () => {
  it.each([
    [2 * 1024 ** 3, '2', 'GB'],
    [3 * 1024 ** 4, '3', 'TB'],
    [512 * 1024 ** 2, '512', 'MB'],
    [1.5 * 1024 ** 2, '1.5', 'MB'],
    [1.5 * 1024 ** 3, '1.5', 'GB'],
    [2.5 * 1024 ** 4, '2.5', 'TB'],
    [0.5 * 1024 ** 3, '512', 'MB'],
  ])('shows %d bytes as %s %s', (bytes, amount, unit) => {
    expect(bytesToAmountUnit(bytes)).toEqual({ amount, unit })
  })

  it('steps down a unit when the larger one needs more than one decimal', () => {
    expect(bytesToAmountUnit(1.25 * 1024 ** 3)).toEqual({ amount: '1280', unit: 'MB' })
  })

  it('keeps an amount no unit shows in one decimal exact in the largest unit at or above one', () => {
    expect(bytesToAmountUnit(1024 ** 2 + 1)).toEqual({ amount: String((1024 ** 2 + 1) / 1024 ** 2), unit: 'MB' })
  })

  it('falls back to MB for an amount below one MB', () => {
    expect(bytesToAmountUnit(512 * 1024)).toEqual({ amount: '0.5', unit: 'MB' })
  })
})
