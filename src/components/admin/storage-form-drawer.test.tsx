import { StorageStatus } from '@shared/constants'
import type { Storage } from '@shared/types'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createStorage, replaceStorage } from '@/lib/api'
import { StorageFormDrawer } from './storage-form-drawer'

class TestResizeObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
}

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => key,
  }),
}))

vi.mock('sonner', () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
  },
}))

vi.mock('@/lib/api', () => ({
  createStorage: vi.fn(),
  replaceStorage: vi.fn(),
}))

vi.mock('@/lib/eplist', () => ({
  eplistEndpointUrl: (endpoint: string) => (endpoint.startsWith('http') ? endpoint : `https://${endpoint}`),
  findEplistProvider: (providers: Array<{ slug: string; displayName: string; file: string }>, provider: string) =>
    providers.find((item) => item.slug === provider || item.displayName === provider),
  listEplistProviders: vi.fn(async () => [{ slug: 'tigris', displayName: 'Tigris', file: 'tigris.yml' }]),
  listEplistEndpoints: vi.fn(async () => [
    { region: 'auto', endpoint: 't3.storage.dev' },
    { region: 'fly', endpoint: 'fly.storage.tigris.dev' },
  ]),
}))

const storage: Storage = {
  id: 'storage-1',
  provider: 'aws-s3',
  bucket: 'bucket',
  endpoint: 'https://s3.example.com',
  region: 'auto',
  accessKey: 'access-key',
  secretKey: 'secret-key',
  filePath: '',
  customHost: null,
  capacity: 2 * 1024 * 1024 * 1024,
  forcePathStyle: true,
  egressCreditBillingEnabled: true,
  egressCreditUnitBytes: 100 * 1024 * 1024,
  egressCreditPerUnit: 3,
  used: 0,
  enabled: true,
  status: StorageStatus.HEALTHY,
  statusReason: null,
  statusCheckedAt: '2026-01-01T00:00:00.000Z',
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
}

function renderStorageFormDrawer(props: Partial<Parameters<typeof StorageFormDrawer>[0]> = {}) {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  })

  return render(
    <QueryClientProvider client={queryClient}>
      <StorageFormDrawer open onOpenChange={() => undefined} storage={null} {...props} />
    </QueryClientProvider>,
  )
}

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  vi.clearAllMocks()
})

describe('StorageFormDrawer', () => {
  it('submits a create payload through the shared admin form drawer', async () => {
    vi.stubGlobal('ResizeObserver', TestResizeObserver)
    vi.mocked(createStorage).mockResolvedValue(storage)
    const onOpenChange = vi.fn()
    renderStorageFormDrawer({ onOpenChange })

    fireEvent.change(screen.getByLabelText('admin.storages.fieldProvider'), { target: { value: 'custom-s3' } })
    fireEvent.change(screen.getByLabelText('admin.storages.fieldBucket'), { target: { value: 'new-bucket' } })
    fireEvent.change(screen.getByLabelText('admin.storages.fieldEndpoint'), {
      target: { value: 'https://storage.example.com' },
    })
    fireEvent.change(screen.getByLabelText('admin.storages.fieldRegion'), { target: { value: 'auto' } })
    fireEvent.change(screen.getByLabelText('admin.storages.fieldAccessKey'), { target: { value: 'new-access' } })
    fireEvent.change(screen.getByLabelText('admin.storages.fieldSecretKey'), { target: { value: 'new-secret' } })
    fireEvent.click(screen.getByRole('button', { name: 'common.save' }))

    await waitFor(() =>
      expect(createStorage).toHaveBeenCalledWith(
        expect.objectContaining({
          bucket: 'new-bucket',
          provider: 'custom-s3',
          endpoint: 'https://storage.example.com',
          region: 'auto',
          accessKey: 'new-access',
          secretKey: 'new-secret',
        }),
      ),
    )
    expect(createStorage).not.toHaveBeenCalledWith(expect.objectContaining({ capacity: expect.any(Number) }))
    expect(createStorage).not.toHaveBeenCalledWith(expect.objectContaining({ egressCreditBillingEnabled: false }))
    expect(onOpenChange).toHaveBeenCalledWith(false)
  })

  it('resets edit values, allows provider editing, submits update payload, and toggles secret visibility', async () => {
    vi.stubGlobal('ResizeObserver', TestResizeObserver)
    vi.mocked(replaceStorage).mockResolvedValue(storage)
    renderStorageFormDrawer({ storage })

    const providerInput = screen.getByLabelText('admin.storages.fieldProvider') as HTMLInputElement
    expect(providerInput.value).toBe('aws-s3')
    expect(providerInput.disabled).toBe(false)
    fireEvent.change(providerInput, { target: { value: 'custom-s3' } })
    expect(providerInput.value).toBe('custom-s3')
    expect((screen.getByLabelText('admin.storages.fieldEndpoint') as HTMLInputElement).value).toBe(
      'https://s3.example.com',
    )
    expect((screen.getByLabelText('admin.storages.fieldRegion') as HTMLInputElement).value).toBe('auto')
    const secretInput = screen.getByLabelText('admin.storages.fieldSecretKey') as HTMLInputElement
    expect(secretInput.getAttribute('type')).toBe('password')
    fireEvent.click(screen.getByRole('button', { name: 'admin.storages.showSecretKey' }))
    expect(secretInput.getAttribute('type')).toBe('text')
    expect(screen.getByRole('button', { name: 'admin.storages.hideSecretKey' })).toBeTruthy()
    expect(screen.queryByLabelText('admin.storages.fieldCapacity')).toBeNull()
    expect(screen.queryByLabelText('admin.storages.egressBillingUnit')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'common.save' }))

    await waitFor(() =>
      expect(replaceStorage).toHaveBeenCalledWith(
        'storage-1',
        expect.objectContaining({
          provider: 'custom-s3',
          capacity: storage.capacity,
          egressCreditPerUnit: storage.egressCreditPerUnit,
          enabled: true,
        }),
      ),
    )
  })

  it('keeps the provider input empty when editing storage without a provider value', () => {
    vi.stubGlobal('ResizeObserver', TestResizeObserver)
    renderStorageFormDrawer({ storage: { ...storage, provider: '' } })

    expect(screen.getByLabelText('admin.storages.fieldProvider')).toHaveProperty('value', '')
  })

  it('loads provider options without selecting an endpoint until endpoint or region is chosen', async () => {
    vi.stubGlobal('ResizeObserver', TestResizeObserver)
    vi.mocked(createStorage).mockResolvedValue(storage)
    renderStorageFormDrawer()

    fireEvent.focus(screen.getByLabelText('admin.storages.fieldProvider'))
    fireEvent.click(await screen.findByRole('option', { name: 'Tigris' }))
    expect((screen.getByLabelText('admin.storages.fieldEndpoint') as HTMLInputElement).value).toBe('')
    expect((screen.getByLabelText('admin.storages.fieldRegion') as HTMLInputElement).value).toBe('')

    fireEvent.focus(screen.getByLabelText('admin.storages.fieldRegion'))
    fireEvent.click(await screen.findByRole('option', { name: 'fly' }))

    expect((screen.getByLabelText('admin.storages.fieldRegion') as HTMLInputElement).value).toBe('fly')
    expect((screen.getByLabelText('admin.storages.fieldEndpoint') as HTMLInputElement).value).toBe(
      'https://fly.storage.tigris.dev',
    )
  })

  it('keeps endpoint and region while typing provider, then clears them when selecting a provider option', async () => {
    vi.stubGlobal('ResizeObserver', TestResizeObserver)
    renderStorageFormDrawer()

    const providerInput = screen.getByLabelText('admin.storages.fieldProvider')
    const endpointInput = screen.getByLabelText('admin.storages.fieldEndpoint') as HTMLInputElement
    const regionInput = screen.getByLabelText('admin.storages.fieldRegion') as HTMLInputElement

    fireEvent.change(endpointInput, { target: { value: 'https://storage.example.com' } })
    fireEvent.change(regionInput, { target: { value: 'us-east-1' } })
    fireEvent.change(providerInput, { target: { value: 't' } })

    expect(endpointInput.value).toBe('https://storage.example.com')
    expect(regionInput.value).toBe('us-east-1')

    fireEvent.click(await screen.findByRole('option', { name: 'Tigris' }))

    expect(endpointInput.value).toBe('')
    expect(regionInput.value).toBe('')
  })

  it('previews the request URL from the current bucket, endpoint, and path-style setting', () => {
    vi.stubGlobal('ResizeObserver', TestResizeObserver)
    renderStorageFormDrawer()

    expect(screen.getByText('admin.storages.previewEmpty')).toBeTruthy()

    fireEvent.change(screen.getByLabelText('admin.storages.fieldBucket'), { target: { value: 'new-bucket' } })
    fireEvent.change(screen.getByLabelText('admin.storages.fieldEndpoint'), {
      target: { value: 'https://storage.example.com' },
    })

    expect(screen.getByText('https://storage.example.com/new-bucket/example-object')).toBeTruthy()
    expect(screen.getByText('admin.storages.previewPathStyle')).toBeTruthy()

    fireEvent.click(screen.getByRole('switch'))

    expect(screen.getByText('https://new-bucket.storage.example.com/example-object')).toBeTruthy()
    expect(screen.getByText('admin.storages.previewVirtualHostedStyle')).toBeTruthy()
  })

  it('previews the public URL with custom host without replacing the SDK request URL', () => {
    vi.stubGlobal('ResizeObserver', TestResizeObserver)
    renderStorageFormDrawer()

    fireEvent.change(screen.getByLabelText('admin.storages.fieldBucket'), { target: { value: 'new-bucket' } })
    fireEvent.change(screen.getByLabelText('admin.storages.fieldEndpoint'), {
      target: { value: 'https://storage.example.com' },
    })
    fireEvent.change(screen.getByLabelText('admin.storages.fieldCustomHost'), {
      target: { value: 'cdn.example.com' },
    })

    expect(screen.getByText('admin.storages.previewRequestUrl')).toBeTruthy()
    expect(screen.getByText('https://storage.example.com/new-bucket/example-object')).toBeTruthy()
    expect(screen.getByText('admin.storages.previewPublicUrl')).toBeTruthy()
    expect(screen.getByText('https://cdn.example.com/example-object')).toBeTruthy()
  })
})
