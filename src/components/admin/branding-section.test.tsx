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

vi.mock('@/lib/api', () => ({
  saveBranding: vi.fn(),
  resetBrandingField: vi.fn(),
}))

import { toast } from 'sonner'
import { saveBranding } from '@/lib/api'

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
})
