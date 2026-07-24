import { DirType } from '@shared/constants'
import type { StorageObject } from '@shared/types'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { createShare } from '@/lib/api'
import { ShareDialog } from './share-dialog'

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, values?: Record<string, unknown>) => (values ? `${key}:${Object.values(values).join('/')}` : key),
  }),
}))

vi.mock('sonner', () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
  },
}))

vi.mock('@/hooks/use-clipboard', () => ({
  useClipboard: () => ({ copy: vi.fn() }),
}))

vi.mock('@/lib/api', () => ({
  createShare: vi.fn(),
}))

const item: StorageObject = {
  id: 'matter-1',
  orgId: 'org-1',
  alias: '',
  name: 'release-notes.pdf',
  type: 'application/pdf',
  size: 1024,
  dirtype: DirType.FILE,
  parent: '',
  object: 'release-notes.pdf',
  storageId: 'storage-1',
  status: 'active',
  trashedAt: null,
  createdAt: '2026-07-23T00:00:00.000Z',
  updatedAt: '2026-07-23T00:00:00.000Z',
}

beforeAll(() => {
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  )
})

afterAll(() => {
  vi.unstubAllGlobals()
})

function renderDialog() {
  const queryClient = new QueryClient({ defaultOptions: { mutations: { retry: false } } })
  return render(
    <QueryClientProvider client={queryClient}>
      <ShareDialog open item={item} onOpenChange={vi.fn()} />
    </QueryClientProvider>,
  )
}

beforeEach(() => {
  vi.mocked(createShare).mockResolvedValue({
    token: 'share-token',
    kind: 'landing',
    urls: { landing: '/s/share-token' },
    expiresAt: null,
    downloadLimit: null,
    listedAt: '2026-07-23T00:00:00.000Z',
  })
})

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

describe('ShareDialog profile listing selection', () => {
  it('sends showOnProfile when the owner enables it for a landing share', async () => {
    renderDialog()

    fireEvent.click(screen.getByRole('switch', { name: 'share.showOnProfile' }))
    fireEvent.click(screen.getByRole('button', { name: 'share.createButton' }))

    await waitFor(() =>
      expect(createShare).toHaveBeenCalledWith(
        expect.objectContaining({
          matterId: 'matter-1',
          kind: 'landing',
          showOnProfile: true,
        }),
        expect.anything(),
      ),
    )
  })

  it('omits showOnProfile unless the owner enables the control', async () => {
    renderDialog()

    fireEvent.click(screen.getByRole('button', { name: 'share.createButton' }))

    await waitFor(() => expect(createShare).toHaveBeenCalled())
    expect(vi.mocked(createShare).mock.calls[0]?.[0]).not.toHaveProperty('showOnProfile')
  })
})
