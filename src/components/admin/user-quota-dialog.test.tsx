import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, fireEvent, render, waitFor } from '@testing-library/react'
import type React from 'react'
import { toast } from 'sonner'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { UserQuotaDialog } from './user-quota-dialog'

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, values?: { name?: string; used?: string }) =>
      values?.name ? `${key}:${values.name}` : values?.used ? `${key}:${values.used}` : key,
  }),
}))

vi.mock('sonner', () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
  },
}))

vi.mock('@/lib/api', () => ({
  updateQuota: vi.fn(),
}))

vi.mock('@/components/ui/dialog', () => ({
  Dialog: ({ open, children }: { open: boolean; onOpenChange: (open: boolean) => void; children: React.ReactNode }) =>
    open ? <div>{children}</div> : null,
  DialogContent: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DialogDescription: ({ children }: { children: React.ReactNode }) => <p>{children}</p>,
  DialogFooter: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DialogHeader: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DialogTitle: ({ children }: { children: React.ReactNode }) => <h2>{children}</h2>,
}))

vi.mock('@/components/ui/button', () => ({
  Button: ({ children, type, ...props }: React.ButtonHTMLAttributes<HTMLButtonElement> & { variant?: string }) => (
    <button type={type ?? 'button'} {...props}>
      {children}
    </button>
  ),
}))

vi.mock('@/components/ui/input', () => ({
  Input: (props: React.InputHTMLAttributes<HTMLInputElement>) => <input {...props} />,
}))

vi.mock('@/components/ui/label', () => ({
  Label: ({ children, htmlFor }: { children: React.ReactNode; htmlFor?: string }) => (
    <label htmlFor={htmlFor}>{children}</label>
  ),
}))

const user = {
  name: 'Test User',
  orgId: 'org-1',
  quotaUsed: 512,
  quotaTotal: 2 * 1024 * 1024 * 1024,
}

function renderDialog(props: Partial<React.ComponentProps<typeof UserQuotaDialog>> = {}) {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  })

  return render(
    <QueryClientProvider client={queryClient}>
      <UserQuotaDialog open onOpenChange={vi.fn()} user={user} {...props} />
    </QueryClientProvider>,
  )
}

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

describe('UserQuotaDialog', () => {
  it('shows the generic success toast by default after saving', async () => {
    const onSave = vi.fn().mockResolvedValue({ orgId: user.orgId, quota: 3 })
    const onOpenChange = vi.fn()
    const view = renderDialog({ onOpenChange, onSave })

    fireEvent.change(view.getByLabelText('admin.users.quotaLabel'), { target: { value: '3' } })
    fireEvent.submit(view.getByRole('button', { name: 'common.save' }).closest('form')!)

    await waitFor(() => expect(onSave).toHaveBeenCalledWith(3 * 1024 * 1024 * 1024))
    expect(onOpenChange).toHaveBeenCalledWith(false)
    expect(toast.success).toHaveBeenCalledWith('admin.users.quotaUpdated')
  })

  it('does not show the generic success toast when disabled', async () => {
    const onSave = vi.fn().mockResolvedValue({ updated: 2 })
    const onOpenChange = vi.fn()
    const view = renderDialog({ onOpenChange, onSave, showSuccessToast: false })

    fireEvent.change(view.getByLabelText('admin.users.quotaLabel'), { target: { value: '4' } })
    fireEvent.submit(view.getByRole('button', { name: 'common.save' }).closest('form')!)

    await waitFor(() => expect(onSave).toHaveBeenCalledWith(4 * 1024 * 1024 * 1024))
    expect(onOpenChange).toHaveBeenCalledWith(false)
    expect(toast.success).not.toHaveBeenCalled()
  })
})
