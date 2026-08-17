import { DirType } from '@shared/constants'
import type { StorageObject } from '@shared/types'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { getObjectCreator } from '@/lib/api'
import { FileDetailsSheet } from './file-details-sheet'

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}))

vi.mock('./file-icon', () => ({ FileIcon: () => <span data-testid="file-icon" /> }))
vi.mock('@/lib/api', () => ({ getObjectCreator: vi.fn() }))

const item: StorageObject = {
  id: 'file-1',
  orgId: 'org-1',
  alias: 'alias-1',
  name: 'report.pdf',
  type: 'application/pdf',
  size: 1024,
  dirtype: DirType.FILE,
  parent: 'Reports',
  object: 'object-key',
  storageId: 'storage-1',
  status: 'active',
  trashedAt: null,
  createdBy: {
    type: 'agent',
    ref: 'agent-1',
    issuer: 'https://realm.example.com',
  },
  createdAt: '2026-08-01T12:00:00.000Z',
  updatedAt: '2026-08-02T12:00:00.000Z',
}

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

describe('FileDetailsSheet', () => {
  it('loads the creator profile and shows file metadata', async () => {
    vi.mocked(getObjectCreator).mockResolvedValue({
      ...item.createdBy!,
      name: 'Report Agent',
      image: null,
    })
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    render(
      <QueryClientProvider client={queryClient}>
        <FileDetailsSheet item={item} onOpenChange={vi.fn()} />
      </QueryClientProvider>,
    )

    expect(screen.getByText('report.pdf')).toBeTruthy()
    expect(await screen.findByText('Report Agent')).toBeTruthy()
    expect(screen.getByText('/Reports')).toBeTruthy()
    expect(screen.getByText('1.0 KB')).toBeTruthy()
  })

  it('does not render without a selected item', () => {
    const { container } = render(<FileDetailsSheet item={null} onOpenChange={vi.fn()} />)

    expect(container.firstChild).toBeNull()
  })
})
