import type { AuthProvider } from '@shared/types'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { OAuthProvidersSection } from './oauth-providers-section'

class TestResizeObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
}

const copy = vi.fn()

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, options?: Record<string, unknown>) => (options?.name ? `${key}:${String(options.name)}` : key),
  }),
}))

vi.mock('sonner', () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
  },
}))

vi.mock('@/hooks/use-clipboard', () => ({
  useClipboard: () => ({ copy }),
}))

vi.mock('@/lib/api', async (importOriginal) => ({
  ApiError: (await importOriginal<typeof import('@/lib/api')>()).ApiError,
  listAuthProviders: vi.fn(),
  upsertAuthProvider: vi.fn(),
  deleteAuthProvider: vi.fn(),
}))

import { toast } from 'sonner'
import { ApiError, listAuthProviders, upsertAuthProvider } from '@/lib/api'

function makeProvider(overrides: Partial<AuthProvider>): AuthProvider {
  return {
    providerId: 'github',
    type: 'builtin',
    enabled: true,
    name: 'GitHub',
    icon: 'github',
    clientId: 'client-id',
    discoveryUrl: null,
    scopes: null,
    callbackUri: 'https://files.example/api/auth/callback/github',
    clientSecret: '****alue',
    ...overrides,
  }
}

function renderSection() {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  })

  return render(
    <QueryClientProvider client={queryClient}>
      <OAuthProvidersSection />
    </QueryClientProvider>,
  )
}

beforeEach(() => {
  vi.stubGlobal('ResizeObserver', TestResizeObserver)
  Element.prototype.scrollIntoView = vi.fn()
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  vi.clearAllMocks()
})

describe('OAuthProvidersSection', () => {
  it('shows the built-in callback URI from the provider payload and copies it', async () => {
    vi.mocked(listAuthProviders).mockResolvedValue({
      items: [makeProvider({})],
      callbackBaseUri: 'https://auth.example',
    })

    renderSection()

    fireEvent.click(await screen.findByRole('button', { name: 'common.edit' }))

    const callbackInput = (await screen.findByLabelText('admin.auth.callbackUri')) as HTMLInputElement
    expect(callbackInput.value).toBe('https://files.example/api/auth/callback/github')

    fireEvent.click(screen.getByRole('button', { name: 'admin.auth.copyCallbackUri' }))
    expect(copy).toHaveBeenCalledWith('https://files.example/api/auth/callback/github', 'admin.auth.callbackUriCopied')
  })

  it('shows the OIDC callback URI from the provider payload when editing a custom provider', async () => {
    vi.mocked(listAuthProviders).mockResolvedValue({
      items: [
        makeProvider({
          providerId: 'company-sso',
          type: 'oidc',
          name: 'company-sso',
          icon: 'company-sso',
          discoveryUrl: 'https://accounts.example.com/.well-known/openid-configuration',
          scopes: ['openid', 'email'],
          callbackUri: 'https://files.example/api/auth/oauth2/callback/company-sso',
        }),
      ],
      callbackBaseUri: 'https://auth.example',
    })

    renderSection()

    fireEvent.click(await screen.findByRole('button', { name: 'common.edit' }))

    await waitFor(() => {
      expect((screen.getByLabelText('admin.auth.callbackUri') as HTMLInputElement).value).toBe(
        'https://files.example/api/auth/oauth2/callback/company-sso',
      )
    })
  })

  it('uses callbackBaseUri from the provider list when previewing a new OIDC provider', async () => {
    vi.mocked(listAuthProviders).mockResolvedValue({
      items: [],
      callbackBaseUri: 'https://auth.configured.example',
    })

    renderSection()

    const addButton = await screen.findByRole('button', { name: 'admin.auth.addProvider' })
    await waitFor(() => expect((addButton as HTMLButtonElement).disabled).toBe(false))
    fireEvent.click(addButton)
    fireEvent.click(screen.getByRole('radio', { name: 'admin.auth.providerOidc' }))
    fireEvent.change(screen.getByLabelText('admin.auth.providerId'), { target: { value: 'new-sso' } })

    await waitFor(() => {
      expect((screen.getByLabelText('admin.auth.callbackUri') as HTMLInputElement).value).toBe(
        'https://auth.configured.example/api/auth/oauth2/callback/new-sso',
      )
    })
  })

  it('shows a value the server rejects under its field [spec: form-errors/admin-drawer]', async () => {
    vi.mocked(listAuthProviders).mockResolvedValue({
      items: [makeProvider({})],
      callbackBaseUri: 'https://auth.example',
    })
    vi.mocked(upsertAuthProvider).mockRejectedValue(
      new ApiError(400, {
        error: {
          code: 400,
          message: 'Invalid value for clientId',
          status: 'INVALID_ARGUMENT',
          details: [{ reason: 'INVALID_ARGUMENT', domain: 'zpan.dev', metadata: { field: 'clientId' } }],
        },
      }),
    )
    renderSection()

    fireEvent.click(await screen.findByRole('button', { name: 'common.edit' }))
    fireEvent.click(await screen.findByRole('button', { name: 'common.save' }))

    const error = await screen.findByText('Invalid value for clientId')
    const clientId = screen.getByLabelText('admin.auth.clientId')
    expect(clientId.getAttribute('aria-invalid')).toBe('true')
    expect(clientId.getAttribute('aria-describedby')).toContain(error.id)
    expect(screen.queryByRole('alert')).toBeNull()
    expect(screen.getByText('admin.auth.editProviderTitle')).toBeTruthy()
    expect(toast.error).not.toHaveBeenCalled()
  })

  it('shows a rejected save that names no field above the save button', async () => {
    vi.mocked(listAuthProviders).mockResolvedValue({
      items: [makeProvider({})],
      callbackBaseUri: 'https://auth.example',
    })
    vi.mocked(upsertAuthProvider).mockRejectedValue(new Error('Provider is managed by the environment'))
    renderSection()

    fireEvent.click(await screen.findByRole('button', { name: 'common.edit' }))
    fireEvent.click(await screen.findByRole('button', { name: 'common.save' }))

    expect((await screen.findByRole('alert')).textContent).toBe('Provider is managed by the environment')
    expect(toast.error).not.toHaveBeenCalled()
  })
})
