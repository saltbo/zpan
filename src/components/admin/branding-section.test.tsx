import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { TooltipProvider } from '@/components/ui/tooltip'
import { BrandingSection } from './branding-section'

class TestResizeObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
}

vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }))

vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }))

vi.mock('@/hooks/useEntitlement', () => ({
  useEntitlement: () => ({ hasFeature: () => true, isLoading: false }),
}))

vi.mock('@/lib/api', async (importOriginal) => ({
  ApiError: (await importOriginal<typeof import('@/lib/api')>()).ApiError,
  saveBranding: vi.fn(),
  resetBrandingField: vi.fn(),
}))

import { toast } from 'sonner'
import { ApiError, saveBranding } from '@/lib/api'

function rejection(status: number, message: string, field: string) {
  return new ApiError(status, {
    error: {
      code: status,
      message,
      status: 'INVALID_ARGUMENT',
      details: [{ reason: 'INVALID_ARGUMENT', domain: 'zpan.dev', metadata: { field } }],
    },
  })
}

async function saveRejectedWith(error: Error) {
  vi.mocked(saveBranding).mockRejectedValue(error)
  renderSection()
  fireEvent.click(screen.getByRole('button', { name: 'common.edit' }))
  fireEvent.click(await screen.findByRole('button', { name: 'admin.settings.branding.save' }))
}

function renderSection() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })
  return render(
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <BrandingSection />
      </TooltipProvider>
    </QueryClientProvider>,
  )
}

beforeEach(() => {
  vi.stubGlobal('ResizeObserver', TestResizeObserver)
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  vi.clearAllMocks()
})

describe('BrandingSection', () => {
  it('shows a rejected save above the save button and keeps the drawer open [spec: form-errors/admin-drawer]', async () => {
    vi.mocked(saveBranding).mockRejectedValue(new Error('Logo must be 2 MB or smaller'))
    renderSection()

    fireEvent.click(screen.getByRole('button', { name: 'common.edit' }))
    fireEvent.click(await screen.findByRole('button', { name: 'admin.settings.branding.save' }))

    expect((await screen.findByRole('alert')).textContent).toBe('Logo must be 2 MB or smaller')
    expect(screen.getByRole('button', { name: 'admin.settings.branding.save' })).toBeTruthy()
    expect(toast.error).not.toHaveBeenCalled()
  })

  it.each([
    ['logo', 'logo-upload', 413, 'Logo too large. Max 256 KB.'],
    ['favicon', 'favicon-upload', 400, 'Invalid file type for favicon'],
    ['theme_canvas_color', 'theme-canvas', 422, 'theme_canvas_color must be a CSS hex color'],
    ['theme_mode', 'theme-mode', 422, 'theme_mode must be preset or custom'],
  ])('shows a rejection naming %s under that field [spec: form-errors/branding]', async (field, id, status, message) => {
    await saveRejectedWith(rejection(status, message, field))

    const control = await screen.findByText(message)
    expect(control.id).toBe(`${id}-error`)
    expect(document.getElementById(id)?.getAttribute('aria-invalid')).toBe('true')
    expect(screen.queryByRole('alert')).toBeNull()
    expect(screen.getByRole('button', { name: 'admin.settings.branding.save' })).toBeTruthy()
  })

  it('keeps a rejection naming a field the drawer does not show above the save button [spec: form-errors/branding]', async () => {
    await saveRejectedWith(rejection(422, 'wordmark_text must be 24 characters or fewer', 'wordmark_text'))

    expect((await screen.findByRole('alert')).textContent).toBe('wordmark_text must be 24 characters or fewer')
  })
})
