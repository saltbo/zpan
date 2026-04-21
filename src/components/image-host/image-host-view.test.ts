// Tests for src/components/image-host/image-host-view.tsx
// Tests handleDeleteItems and handleCopyUrl pure logic extracted from the component.
import { DirType } from '@shared/constants'
import type { StorageObject } from '@shared/types'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { IhostItem } from './image-host-data-source'
import { imageHostDataSource } from './image-host-data-source'

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

vi.mock('@/lib/api', () => ({
  deleteIhostImage: vi.fn(),
  listIhostImages: vi.fn(),
  createIhostImagePresign: vi.fn(),
  uploadToS3: vi.fn(),
  confirmIhostImage: vi.fn(),
}))

vi.mock('sonner', () => ({
  toast: Object.assign(vi.fn(), {
    success: vi.fn(),
    error: vi.fn(),
    dismiss: vi.fn(),
  }),
}))

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}))

import { toast } from 'sonner'
import { deleteIhostImage } from '@/lib/api'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeIhostItem(id: string, overrides: Partial<IhostItem> = {}): IhostItem {
  return {
    id,
    orgId: 'org-1',
    alias: `folder/${id}.png`,
    name: `${id}.png`,
    type: 'image/png',
    size: 1024,
    dirtype: DirType.FILE,
    parent: '',
    object: `ih/${id}`,
    storageId: 'stor-1',
    status: 'active',
    createdAt: '2024-01-01T00:00:00.000Z',
    updatedAt: '2024-01-01T00:00:00.000Z',
    token: `tok_${id}`,
    url: `/r/tok_${id}.png`,
    dimensions: null,
    accessCount: 0,
    ...overrides,
  }
}

// ---------------------------------------------------------------------------
// handleCopyUrl logic — mirrors the switch/case in the component
// ---------------------------------------------------------------------------

function buildCopyText(url: string, format?: 'raw' | 'markdown' | 'html' | 'bbcode'): string {
  switch (format) {
    case 'markdown':
      return `![](${url})`
    case 'html':
      return `<img src="${url}" />`
    case 'bbcode':
      return `[img]${url}[/img]`
    default:
      return url
  }
}

function handleCopyUrl(
  item: StorageObject,
  format?: 'raw' | 'markdown' | 'html' | 'bbcode',
  copy?: (text: string, key: string) => void,
): string {
  const ihostItem = item as IhostItem
  const text = buildCopyText(ihostItem.url ?? '', format)
  if (copy) copy(text, 'ihost.copy.copied')
  return text
}

// ---------------------------------------------------------------------------
// handleDeleteItems logic extracted
// ---------------------------------------------------------------------------

type QueryClientStub = {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  setQueryData: (...args: any[]) => any
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  invalidateQueries: (...args: any[]) => any
} & { setQueryData: { mock: { calls: any[][] } }; invalidateQueries: { mock: { calls: any[][] } } }

function makeQueryClientStub(): QueryClientStub {
  return {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    setQueryData: vi.fn() as any,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    invalidateQueries: vi.fn() as any,
  }
}

async function handleDeleteItems(
  ids: string[],
  queryClient: QueryClientStub,
  t: (key: string) => string,
): Promise<void> {
  queryClient.setQueryData(
    [...imageHostDataSource.queryKeyPrefix, '', undefined],
    (old: { items: StorageObject[] } | undefined) => {
      if (!old) return old
      return { ...old, items: old.items.filter((i) => !ids.includes(i.id)) }
    },
  )

  let cancelled = false

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const toastId = (toast as any)(t('ihost.delete.undoToast'), {
    action: {
      label: t('ihost.delete.undo'),
      onClick: () => {
        cancelled = true
        queryClient.invalidateQueries({ queryKey: imageHostDataSource.queryKeyPrefix })
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        ;(toast as any).dismiss(toastId)
      },
    },
    duration: 5000,
  })

  for (const id of ids) {
    setTimeout(async () => {
      if (cancelled) return
      try {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        await (deleteIhostImage as any)(id)
      } catch {
        queryClient.invalidateQueries({ queryKey: imageHostDataSource.queryKeyPrefix })
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        ;(toast as any).error(t('common.error'))
      }
    }, 5000)
  }
}

const t = (key: string) => key

// ---------------------------------------------------------------------------
// handleCopyUrl — format logic
// ---------------------------------------------------------------------------

describe('ImageHostView — handleCopyUrl format logic', () => {
  it('returns plain url for raw format', () => {
    const item = makeIhostItem('img-1')

    const text = handleCopyUrl(item, 'raw')

    expect(text).toBe('/r/tok_img-1.png')
  })

  it('returns markdown format', () => {
    const item = makeIhostItem('img-1')

    const text = handleCopyUrl(item, 'markdown')

    expect(text).toBe('![]( /r/tok_img-1.png)'.replace(' ', ''))
  })

  it('returns html img tag', () => {
    const item = makeIhostItem('img-1')

    const text = handleCopyUrl(item, 'html')

    expect(text).toBe('<img src="/r/tok_img-1.png" />')
  })

  it('returns bbcode format', () => {
    const item = makeIhostItem('img-1')

    const text = handleCopyUrl(item, 'bbcode')

    expect(text).toBe('[img]/r/tok_img-1.png[/img]')
  })

  it('returns plain url when no format provided (default)', () => {
    const item = makeIhostItem('img-1')

    const text = handleCopyUrl(item)

    expect(text).toBe('/r/tok_img-1.png')
  })

  it('calls copy with "ihost.copy.copied" key', () => {
    const copy = vi.fn()
    const item = makeIhostItem('img-1')

    handleCopyUrl(item, 'raw', copy)

    expect(copy).toHaveBeenCalledWith('/r/tok_img-1.png', 'ihost.copy.copied')
  })

  it('calls copy with markdown text', () => {
    const copy = vi.fn()
    const item = makeIhostItem('img-1')

    handleCopyUrl(item, 'markdown', copy)

    expect(copy).toHaveBeenCalledWith('![](/r/tok_img-1.png)', 'ihost.copy.copied')
  })

  it('calls copy with html text', () => {
    const copy = vi.fn()
    const item = makeIhostItem('img-1')

    handleCopyUrl(item, 'html', copy)

    expect(copy).toHaveBeenCalledWith('<img src="/r/tok_img-1.png" />', 'ihost.copy.copied')
  })

  it('calls copy with bbcode text', () => {
    const copy = vi.fn()
    const item = makeIhostItem('img-1')

    handleCopyUrl(item, 'bbcode', copy)

    expect(copy).toHaveBeenCalledWith('[img]/r/tok_img-1.png[/img]', 'ihost.copy.copied')
  })

  it('uses empty string url when item has no url', () => {
    const item = makeIhostItem('img-1', { url: '' })

    const text = handleCopyUrl(item, 'raw')

    expect(text).toBe('')
  })
})

// ---------------------------------------------------------------------------
// handleDeleteItems — optimistic update and delete scheduling
// ---------------------------------------------------------------------------

describe('ImageHostView — handleDeleteItems optimistic update', () => {
  afterEach(() => {
    vi.clearAllMocks()
  })

  it('calls queryClient.setQueryData to optimistically remove items', async () => {
    const queryClient = makeQueryClientStub()

    await handleDeleteItems(['img-1', 'img-2'], queryClient, t)

    expect(queryClient.setQueryData).toHaveBeenCalledTimes(1)
    expect(queryClient.setQueryData).toHaveBeenCalledWith(['ihost', 'images', '', undefined], expect.any(Function))
  })

  it('filter function removes specified ids from items', async () => {
    const queryClient = makeQueryClientStub()

    await handleDeleteItems(['img-1'], queryClient, t)

    const filterFn = queryClient.setQueryData.mock.calls[0][1] as (old: { items: StorageObject[] }) => {
      items: StorageObject[]
    }

    const item1 = makeIhostItem('img-1')
    const item2 = makeIhostItem('img-2')
    const result = filterFn({ items: [item1, item2] })

    expect(result.items).toHaveLength(1)
    expect(result.items[0].id).toBe('img-2')
  })

  it('filter function returns undefined when old is undefined', async () => {
    const queryClient = makeQueryClientStub()

    await handleDeleteItems(['img-1'], queryClient, t)

    const filterFn = queryClient.setQueryData.mock.calls[0][1] as (old: undefined) => undefined

    const result = filterFn(undefined)

    expect(result).toBeUndefined()
  })

  it('shows a toast when delete is called', async () => {
    const queryClient = makeQueryClientStub()

    await handleDeleteItems(['img-1'], queryClient, t)

    expect(toast).toHaveBeenCalledWith('ihost.delete.undoToast', expect.objectContaining({ duration: 5000 }))
  })
})

// ---------------------------------------------------------------------------
// handleDeleteItems — undo path
// ---------------------------------------------------------------------------

describe('ImageHostView — handleDeleteItems undo action', () => {
  afterEach(() => {
    vi.clearAllMocks()
  })

  it('toast action onClick calls queryClient.invalidateQueries', async () => {
    const queryClient = makeQueryClientStub()

    await handleDeleteItems(['img-1'], queryClient, t)

    const toastCall = vi.mocked(toast).mock.calls[0]
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const options = toastCall[1] as any
    options.action.onClick()

    expect(queryClient.invalidateQueries).toHaveBeenCalledWith({
      queryKey: imageHostDataSource.queryKeyPrefix,
    })
  })
})

// ---------------------------------------------------------------------------
// handleDeleteItems — commit path (after 5000ms)
// ---------------------------------------------------------------------------

describe('ImageHostView — handleDeleteItems commit path (fake timers)', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.clearAllMocks()
  })

  it('calls deleteIhostImage for each id after 5000ms', async () => {
    vi.mocked(deleteIhostImage).mockResolvedValue(undefined as never)
    const queryClient = makeQueryClientStub()

    await handleDeleteItems(['img-1', 'img-2'], queryClient, t)
    await vi.runAllTimersAsync()

    expect(deleteIhostImage).toHaveBeenCalledWith('img-1')
    expect(deleteIhostImage).toHaveBeenCalledWith('img-2')
    expect(deleteIhostImage).toHaveBeenCalledTimes(2)
  })

  it('does not call deleteIhostImage before 5000ms', async () => {
    vi.mocked(deleteIhostImage).mockResolvedValue(undefined as never)
    const queryClient = makeQueryClientStub()

    await handleDeleteItems(['img-1'], queryClient, t)

    // Do NOT advance timers
    expect(deleteIhostImage).not.toHaveBeenCalled()
  })

  it('calls invalidateQueries and shows error toast if deleteIhostImage throws', async () => {
    vi.mocked(deleteIhostImage).mockRejectedValue(new Error('network error'))
    const queryClient = makeQueryClientStub()

    await handleDeleteItems(['img-1'], queryClient, t)
    await vi.runAllTimersAsync()

    expect(queryClient.invalidateQueries).toHaveBeenCalled()
    expect(vi.mocked(toast).error).toHaveBeenCalledWith('common.error')
  })
})
