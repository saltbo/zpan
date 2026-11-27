import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { EmailConfigSection } from './email-config-section'

class TestResizeObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
}

vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }))

vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }))

vi.mock('@/lib/api', async (importOriginal) => ({
  ApiError: (await importOriginal<typeof import('@/lib/api')>()).ApiError,
  getEmailConfig: vi.fn(),
  saveEmailConfig: vi.fn(),
  testEmail: vi.fn(),
}))

import { toast } from 'sonner'
import { ApiError, getEmailConfig, saveEmailConfig } from '@/lib/api'

function renderSection() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })
  return render(
    <QueryClientProvider client={queryClient}>
      <EmailConfigSection />
    </QueryClientProvider>,
  )
}

async function saveFromDrawer() {
  fireEvent.click(await screen.findByRole('button', { name: 'common.edit' }))
  fireEvent.click(await screen.findByRole('button', { name: 'common.save' }))
}

beforeEach(() => {
  vi.stubGlobal('ResizeObserver', TestResizeObserver)
  vi.mocked(getEmailConfig).mockResolvedValue({
    provider: 'http',
    enabled: true,
    requireEmailVerification: false,
    from: 'noreply@example.com',
    http: { url: 'mailer', apiKey: 'key' },
  } as Awaited<ReturnType<typeof getEmailConfig>>)
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  vi.clearAllMocks()
})

describe('EmailConfigSection', () => {
  it('shows a value the server rejects under its field [spec: form-errors/admin-drawer]', async () => {
    vi.mocked(saveEmailConfig).mockRejectedValue(
      new ApiError(400, {
        error: {
          code: 400,
          message: 'Invalid value for http.url',
          status: 'INVALID_ARGUMENT',
          details: [{ reason: 'INVALID_ARGUMENT', domain: 'zpan.dev', metadata: { field: 'http.url' } }],
        },
      }),
    )
    renderSection()

    await saveFromDrawer()

    const error = await screen.findByText('Invalid value for http.url')
    const url = screen.getByLabelText('admin.auth.httpUrl')
    expect(url.getAttribute('aria-invalid')).toBe('true')
    expect(url.getAttribute('aria-describedby')).toContain(error.id)
    expect(screen.queryByRole('alert')).toBeNull()
    expect(screen.getByRole('button', { name: 'common.save' })).toBeTruthy()
    expect(toast.error).not.toHaveBeenCalled()
  })

  it('shows a rejected save that names no field above the save button', async () => {
    vi.mocked(saveEmailConfig).mockRejectedValue(new Error('Email delivery is unavailable'))
    renderSection()

    await saveFromDrawer()

    expect((await screen.findByRole('alert')).textContent).toBe('Email delivery is unavailable')
    expect(toast.error).not.toHaveBeenCalled()
  })

  it('clears the error when the drawer is closed and reopened', async () => {
    vi.mocked(saveEmailConfig).mockRejectedValue(new Error('Email delivery is unavailable'))
    renderSection()

    await saveFromDrawer()
    await screen.findByRole('alert')
    fireEvent.click(screen.getByRole('button', { name: 'common.cancel' }))
    fireEvent.click(await screen.findByRole('button', { name: 'common.edit' }))

    await screen.findByRole('button', { name: 'common.save' })
    expect(screen.queryByRole('alert')).toBeNull()
  })
})
