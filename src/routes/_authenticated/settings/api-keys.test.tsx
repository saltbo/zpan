import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createIhostApiKey } from '@/lib/api'
import { CreateApiKeyDialog } from './api-keys'

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}))

vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }))

vi.mock('@/lib/auth-client', () => ({
  useListOrganizations: () => ({ data: [] }),
  useSession: () => ({ data: null }),
}))

vi.mock('@/lib/api', () => ({
  createIhostApiKey: vi.fn(),
  createRemoteDownloadApiKey: vi.fn(),
  createWebDavAppPassword: vi.fn(),
  listApiKeys: vi.fn(),
  revokeIhostApiKey: vi.fn(),
  revokeRemoteDownloadApiKey: vi.fn(),
  revokeWebDavAppPassword: vi.fn(),
}))

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

function renderDialog() {
  const queryClient = new QueryClient({ defaultOptions: { mutations: { retry: false } } })
  return render(
    <QueryClientProvider client={queryClient}>
      <CreateApiKeyDialog
        open
        organizations={[{ id: 'org-1', name: 'Personal' }]}
        onOpenChange={vi.fn()}
        onCreated={vi.fn()}
      />
    </QueryClientProvider>,
  )
}

describe('CreateApiKeyDialog field errors', () => {
  it('shows the missing workspace under the workspace field [spec: form-errors/api-key]', async () => {
    renderDialog()

    fireEvent.change(screen.getByLabelText('settings.apiKeys.nameLabel'), { target: { value: 'CI' } })
    fireEvent.click(screen.getByRole('button', { name: 'settings.apiKeys.create' }))

    const error = await screen.findByText('settings.apiKeys.orgRequired')
    expect(screen.getByLabelText('settings.apiKeys.scopeLabel').getAttribute('aria-describedby')).toBe(error.id)
    expect(createIhostApiKey).not.toHaveBeenCalled()
  })

  it('shows a blank name under the name field', async () => {
    renderDialog()

    const name = screen.getByLabelText('settings.apiKeys.nameLabel')
    fireEvent.change(name, { target: { value: '   ' } })
    fireEvent.click(screen.getByRole('button', { name: 'settings.apiKeys.create' }))

    const error = await screen.findByText('settings.apiKeys.nameRequired')
    expect(name.getAttribute('aria-invalid')).toBe('true')
    expect(name.getAttribute('aria-describedby')).toBe(error.id)
  })

  it('keeps submit disabled until the form changes', () => {
    renderDialog()

    const submit = screen.getByRole('button', { name: 'settings.apiKeys.create' }) as HTMLButtonElement
    expect(submit.disabled).toBe(true)
    fireEvent.change(screen.getByLabelText('settings.apiKeys.nameLabel'), { target: { value: 'C' } })
    return waitFor(() => expect(submit.disabled).toBe(false))
  })
})
