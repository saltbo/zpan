import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ApiError } from '@/lib/api'
import { LoadErrorAlert, loadErrorMessage } from './load-error-alert'

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}))

afterEach(cleanup)

describe('loadErrorMessage', () => {
  it('shows an API error message as the server wrote it', () => {
    const error = new ApiError(503, { error: { code: 503, message: 'Storage is unavailable', status: 'UNAVAILABLE' } })
    expect(loadErrorMessage(error, 'fallback')).toBe('Storage is unavailable')
  })

  it('falls back to the generic hint for anything that is not an API error', () => {
    expect(loadErrorMessage(new TypeError('Failed to fetch'), 'fallback')).toBe('fallback')
    expect(loadErrorMessage('boom', 'fallback')).toBe('fallback')
  })
})

describe('LoadErrorAlert', () => {
  it('renders an alert with a retry action', () => {
    const onRetry = vi.fn()
    render(<LoadErrorAlert error={new Error('x')} onRetry={onRetry} />)

    expect(screen.getByRole('alert').textContent).toContain('common.loadError.title')
    expect(screen.getByRole('alert').textContent).toContain('common.loadError.description')
    fireEvent.click(screen.getByRole('button', { name: 'common.retry' }))
    expect(onRetry).toHaveBeenCalledOnce()
  })

  it('disables retry while a retry is in flight', () => {
    render(<LoadErrorAlert error={new Error('x')} onRetry={vi.fn()} retrying />)
    expect((screen.getByRole('button', { name: 'common.retry' }) as HTMLButtonElement).disabled).toBe(true)
  })
})
