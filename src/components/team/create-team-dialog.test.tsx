import { cleanup, fireEvent, render, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { CreateTeamDialog, TeamLimitDialog } from './create-team-dialog'

const mocks = vi.hoisted(() => ({
  create: vi.fn(),
  invalidateQueries: vi.fn(),
  navigate: vi.fn(),
  onOpenChange: vi.fn(),
  setActive: vi.fn(),
}))

vi.mock('@tanstack/react-query', () => ({
  useMutation: (options: {
    mutationFn: (values: unknown) => Promise<unknown>
    onSuccess?: (data: unknown) => Promise<void> | void
    onError?: (error: Error) => void
  }) => ({
    isPending: false,
    mutate: async (values: unknown) => {
      try {
        const data = await options.mutationFn(values)
        await options.onSuccess?.(data)
      } catch (error) {
        options.onError?.(error as Error)
      }
    },
  }),
  useQueryClient: () => ({ invalidateQueries: mocks.invalidateQueries }),
}))

vi.mock('@tanstack/react-router', () => ({
  useNavigate: () => mocks.navigate,
}))

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}))

vi.mock('sonner', () => ({
  toast: { error: vi.fn(), success: vi.fn() },
}))

vi.mock('@/lib/auth-client', () => ({
  authClient: { organization: { create: mocks.create } },
  setActive: mocks.setActive,
}))

vi.mock('@/components/UpgradeHint', () => ({
  UpgradeHint: ({ feature }: { feature: string }) => <div data-testid="upgrade-hint">{feature}</div>,
}))

vi.mock('@/components/ui/dialog', () => ({
  Dialog: ({ children, open }: { children: ReactNode; open: boolean }) =>
    open ? <div data-testid="dialog">{children}</div> : null,
  DialogContent: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  DialogFooter: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  DialogHeader: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  DialogTitle: ({ children }: { children: ReactNode }) => <h2>{children}</h2>,
}))

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

beforeEach(() => {
  mocks.create.mockResolvedValue({ data: { id: 'new-team' }, error: null })
  mocks.invalidateQueries.mockResolvedValue(undefined)
  mocks.setActive.mockResolvedValue({ data: null, error: null })
})

describe('CreateTeamDialog', () => {
  it('does not render when closed', () => {
    const view = render(<CreateTeamDialog open={false} onOpenChange={mocks.onOpenChange} />)

    expect(view.queryByTestId('dialog')).toBeNull()
  })

  it('creates and activates a team before returning to the files home', async () => {
    const view = render(<CreateTeamDialog open onOpenChange={mocks.onOpenChange} />)

    fireEvent.change(view.getByLabelText('teams.teamName'), { target: { value: 'Design Team' } })
    fireEvent.change(view.getByLabelText(/teams.logo/), { target: { value: 'https://example.com/logo.png' } })
    fireEvent.click(view.getByRole('button', { name: 'common.create' }))

    await waitFor(() =>
      expect(mocks.create).toHaveBeenCalledWith({
        name: 'Design Team',
        slug: expect.stringMatching(/^t[a-z0-9]+$/),
        logo: 'https://example.com/logo.png',
      }),
    )
    expect(mocks.invalidateQueries).toHaveBeenCalledWith({ queryKey: ['organizations'] })
    expect(mocks.onOpenChange).toHaveBeenCalledWith(false)
    expect(mocks.setActive).toHaveBeenCalledWith({ organizationId: 'new-team' })
    expect(mocks.navigate).toHaveBeenCalledWith({ to: '/files' })
  })
})

describe('TeamLimitDialog', () => {
  it('renders the team upgrade hint', () => {
    const view = render(<TeamLimitDialog open onOpenChange={mocks.onOpenChange} />)

    expect(view.getByTestId('upgrade-hint').textContent).toBe('teams_unlimited')
  })
})
