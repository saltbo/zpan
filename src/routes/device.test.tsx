import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { approveDeviceCode, useSession, verifyDeviceCode } from '@/lib/auth-client'
import { DeviceAuthorizationPage } from './device'

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}))

vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }))

vi.mock('@tanstack/react-router', () => ({
  createFileRoute: () => (options: unknown) => options,
  Link: ({ children, to }: { children: ReactNode; to: string }) => <a href={to}>{children}</a>,
}))

vi.mock('@/lib/auth-client', () => ({
  useSession: vi.fn(),
  verifyDeviceCode: vi.fn(),
  approveDeviceCode: vi.fn(),
  denyDeviceCode: vi.fn(),
}))

const signedIn = { data: { user: { id: 'user-1' } } }
const signedOut = { data: null }

beforeEach(() => {
  window.history.replaceState(null, '', '/device?user_code=ABCD-EFGH')
})

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

describe('DeviceAuthorizationPage', () => {
  it('shows the requesting client and scopes before the owner can approve', async () => {
    vi.mocked(useSession).mockReturnValue(signedIn as ReturnType<typeof useSession>)
    vi.mocked(verifyDeviceCode).mockResolvedValue({
      user_code: 'ABCDEFGH',
      status: 'pending',
      client_id: 'zpan-cli',
      scope: 'openid downloader:register',
    })
    vi.mocked(approveDeviceCode).mockResolvedValue({ success: true })

    render(<DeviceAuthorizationPage />)

    expect(await screen.findByText('zpan-cli')).toBeTruthy()
    expect(screen.getByText('openid')).toBeTruthy()
    expect(screen.getByText('downloader:register')).toBeTruthy()
    expect(screen.getByText('device.confirmOrigin')).toBeTruthy()
    expect(verifyDeviceCode).toHaveBeenCalledWith('ABCD-EFGH')

    const approve = screen.getByRole('button', { name: 'device.approve' }) as HTMLButtonElement
    expect(approve.disabled).toBe(false)
    fireEvent.click(approve)
    await waitFor(() => expect(approveDeviceCode).toHaveBeenCalledWith('ABCD-EFGH'))
    expect(await screen.findByText('device.approvedMessage')).toBeTruthy()
  })

  it('blocks approval when the server does not disclose the requesting client', async () => {
    vi.mocked(useSession).mockReturnValue(signedIn as ReturnType<typeof useSession>)
    vi.mocked(verifyDeviceCode).mockResolvedValue({ user_code: 'ABCDEFGH', status: 'pending' })

    render(<DeviceAuthorizationPage />)

    const approve = (await screen.findByRole('button', { name: 'device.approve' })) as HTMLButtonElement
    expect(approve.disabled).toBe(true)
    expect(screen.getByText('device.noPermissions')).toBeTruthy()
  })

  it('re-verifies after sign-in so the owner sees the request details', async () => {
    vi.mocked(useSession).mockReturnValue(signedOut as ReturnType<typeof useSession>)
    vi.mocked(verifyDeviceCode).mockResolvedValueOnce({ user_code: 'ABCDEFGH', status: 'pending' })

    const { rerender } = render(<DeviceAuthorizationPage />)
    expect(await screen.findByText('device.signInRequired')).toBeTruthy()

    vi.mocked(useSession).mockReturnValue(signedIn as ReturnType<typeof useSession>)
    vi.mocked(verifyDeviceCode).mockResolvedValueOnce({
      user_code: 'ABCDEFGH',
      status: 'pending',
      client_id: 'zpan-cli',
      scope: '',
    })
    rerender(<DeviceAuthorizationPage />)

    expect(await screen.findByText('zpan-cli')).toBeTruthy()
    expect(verifyDeviceCode).toHaveBeenCalledTimes(2)
  })

  it('treats a missing user code as invalid without calling the server', async () => {
    window.history.replaceState(null, '', '/device')
    vi.mocked(useSession).mockReturnValue(signedIn as ReturnType<typeof useSession>)

    render(<DeviceAuthorizationPage />)

    expect(await screen.findByText('device.invalid')).toBeTruthy()
    expect(verifyDeviceCode).not.toHaveBeenCalled()
  })
})
