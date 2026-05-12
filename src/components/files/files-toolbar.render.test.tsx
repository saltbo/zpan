import { cleanup, fireEvent, render } from '@testing-library/react'
import type React from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { FilesToolbar } from './files-toolbar'

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, params?: Record<string, unknown>) => (params ? `${key}:${params.count}` : key),
  }),
}))

vi.mock('lucide-react', () => ({
  Archive: () => null,
  Copy: () => null,
  Download: () => null,
  FolderInput: () => null,
  LayoutGrid: () => null,
  List: () => null,
  Share2: () => null,
  Trash2: () => null,
  X: () => null,
}))

vi.mock('@/components/ui/button', () => ({
  Button: ({
    children,
    onClick,
    title,
  }: {
    children: React.ReactNode
    onClick?: React.MouseEventHandler
    title?: string
  }) => (
    <button type="button" onClick={onClick} title={title}>
      {children}
    </button>
  ),
}))

vi.mock('@/components/ui/toggle-group', () => ({
  ToggleGroup: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  ToggleGroupItem: ({ children, 'aria-label': ariaLabel }: { children: React.ReactNode; 'aria-label': string }) => (
    <button type="button" aria-label={ariaLabel}>
      {children}
    </button>
  ),
}))

afterEach(cleanup)

describe('FilesToolbar archive actions', () => {
  it('renders compress for selected items and calls the batch handler', () => {
    const onBatchCompress = vi.fn()
    const { getByTitle, getByText } = render(
      <FilesToolbar
        viewMode="list"
        onViewModeChange={vi.fn()}
        selectedCount={2}
        totalItems={5}
        onBatchCompress={onBatchCompress}
        onClearSelection={vi.fn()}
      />,
    )

    expect(getByText('files.selectedCount:2')).toBeTruthy()
    fireEvent.click(getByTitle('files.compress'))
    expect(onBatchCompress).toHaveBeenCalledTimes(1)
  })
})
