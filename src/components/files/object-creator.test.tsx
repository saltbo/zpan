import { DirType } from '@shared/constants'
import type { StorageObject } from '@shared/types'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ApiError, getObjectCreator } from '@/lib/api'
import { ObjectCreatorAvatar } from './object-creator'

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}))

vi.mock('@/lib/api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/api')>()),
  getObjectCreator: vi.fn(),
}))

const item: StorageObject = {
  id: 'file-1',
  orgId: 'org-1',
  alias: 'alias-1',
  name: 'report.pdf',
  type: 'application/pdf',
  size: 1024,
  dirtype: DirType.FILE,
  parent: '',
  object: 'object-key',
  storageId: 'storage-1',
  status: 'active',
  trashedAt: null,
  createdBy: {
    type: 'agent',
    ref: 'agent-1',
    issuer: 'https://id.realmroot.dev/api/auth',
  },
  createdAt: '2026-08-01T12:00:00.000Z',
  updatedAt: '2026-08-02T12:00:00.000Z',
}

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

describe('ObjectCreatorAvatar', () => {
  it('loads the creator when the avatar is rendered', async () => {
    vi.mocked(getObjectCreator).mockResolvedValue({
      ...item.createdBy!,
      name: 'Jarvis',
      image: 'https://id.realmroot.dev/agent-picture-v1.svg',
      profileUrl: 'https://id.realmroot.dev/agents/agent-1',
    })
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    render(
      <QueryClientProvider client={queryClient}>
        <ObjectCreatorAvatar item={item} />
      </QueryClientProvider>,
    )

    await waitFor(() => expect(getObjectCreator).toHaveBeenCalledWith('file-1'))
    const trigger = await screen.findByLabelText('files.createdBy: Jarvis')
    expect(trigger.classList.contains('flex')).toBe(true)
    expect(trigger.classList.contains('inline-flex')).toBe(false)
    expect(trigger.querySelector('[data-slot="avatar"]')?.getAttribute('data-size')).toBe('sm')
  })

  it('does not request a creator profile when attribution was not recorded', () => {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    render(
      <QueryClientProvider client={queryClient}>
        <ObjectCreatorAvatar item={{ ...item, createdBy: null }} />
      </QueryClientProvider>,
    )

    expect(screen.getByText('actors.notRecorded')).toBeTruthy()
    expect(getObjectCreator).not.toHaveBeenCalled()
  })

  it('does not retry when the creator profile returns 404', async () => {
    vi.mocked(getObjectCreator).mockRejectedValue(
      new ApiError(404, {
        error: { code: 404, message: 'Creator not found', status: 'NOT_FOUND' },
      }),
    )
    const queryClient = new QueryClient({ defaultOptions: { queries: { retryDelay: 0 } } })
    render(
      <QueryClientProvider client={queryClient}>
        <ObjectCreatorAvatar item={item} />
      </QueryClientProvider>,
    )

    await waitFor(() => expect(queryClient.getQueryState(['objects', 'file-1', 'creator'])?.status).toBe('error'))
    expect(getObjectCreator).toHaveBeenCalledTimes(1)
  })
})
