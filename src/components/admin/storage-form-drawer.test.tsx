import { StorageStatus } from '@shared/constants'
import type { Storage } from '@shared/types'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createStorage, updateStorage } from '@/lib/api'
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
  updateStorage: vi.fn(),
}))

const storage: Storage = {
  id: 'storage-1',
  title: 'Primary storage',
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
  status: StorageStatus.ACTIVE,
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

    fireEvent.change(screen.getByLabelText('admin.storages.fieldTitle'), { target: { value: 'New storage' } })
    fireEvent.change(screen.getByLabelText('admin.storages.fieldBucket'), { target: { value: 'new-bucket' } })
    fireEvent.change(screen.getByLabelText('admin.storages.fieldEndpoint'), {
      target: { value: 'https://storage.example.com' },
    })
    fireEvent.change(screen.getByLabelText('admin.storages.fieldRegion'), { target: { value: 'auto' } })
    fireEvent.change(screen.getByLabelText('admin.storages.fieldAccessKey'), { target: { value: 'new-access' } })
    fireEvent.change(screen.getByLabelText('admin.storages.fieldSecretKey'), { target: { value: 'new-secret' } })
    fireEvent.change(screen.getByLabelText('admin.storages.fieldCapacity'), { target: { value: '2' } })
    fireEvent.click(screen.getByRole('button', { name: 'common.save' }))

    await waitFor(() =>
      expect(createStorage).toHaveBeenCalledWith(
        expect.objectContaining({
          title: 'New storage',
          bucket: 'new-bucket',
          endpoint: 'https://storage.example.com',
          region: 'auto',
          accessKey: 'new-access',
          secretKey: 'new-secret',
          capacity: 2 * 1024 * 1024 * 1024,
        }),
      ),
    )
    expect(createStorage).not.toHaveBeenCalledWith(expect.objectContaining({ egressCreditBillingEnabled: false }))
    expect(onOpenChange).toHaveBeenCalledWith(false)
  })

  it('resets edit values, submits update payload, and toggles secret visibility', async () => {
    vi.stubGlobal('ResizeObserver', TestResizeObserver)
    vi.mocked(updateStorage).mockResolvedValue(storage)
    renderStorageFormDrawer({ storage })

    const secretInput = screen.getByLabelText('admin.storages.fieldSecretKey') as HTMLInputElement
    expect(secretInput.getAttribute('type')).toBe('password')
    fireEvent.click(screen.getByRole('button', { name: 'admin.storages.showSecretKey' }))
    expect(secretInput.getAttribute('type')).toBe('text')
    expect(screen.getByRole('button', { name: 'admin.storages.hideSecretKey' })).toBeTruthy()
    expect((screen.getByLabelText('admin.storages.fieldCapacity') as HTMLInputElement).value).toBe('2')
    expect(screen.queryByLabelText('admin.storages.egressBillingUnit')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'common.save' }))

    await waitFor(() =>
      expect(updateStorage).toHaveBeenCalledWith(
        'storage-1',
        expect.objectContaining({
          title: 'Primary storage',
          capacity: 2 * 1024 * 1024 * 1024,
        }),
      ),
    )
    expect(updateStorage).not.toHaveBeenCalledWith('storage-1', expect.objectContaining({ egressCreditPerUnit: 3 }))
  })
})
