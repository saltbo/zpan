import type { MediaLibrary } from '@shared/schemas'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import type React from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { MediaLibraryRemoveDialog } from './media-library-remove-dialog'

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, params?: { path?: string }) => (params?.path ? `${key} ${params.path}` : key),
  }),
}))

vi.mock('@/components/ui/dialog', () => ({
  Dialog: ({ open, children }: { open?: boolean; children: React.ReactNode }) => (open ? <div>{children}</div> : null),
  DialogContent: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DialogDescription: ({ children }: { children: React.ReactNode }) => <p>{children}</p>,
  DialogFooter: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DialogHeader: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DialogTitle: ({ children }: { children: React.ReactNode }) => <h2>{children}</h2>,
}))

afterEach(cleanup)

const library: MediaLibrary = {
  id: 'lib-1',
  orgId: 'org-1',
  folderId: 'folder-1',
  folderPath: 'Movies',
  scanning: false,
  lastScannedAt: null,
  createdBy: { type: 'user', ref: 'user-1', issuer: null },
  createdAt: '2026-11-09T00:00:00.000Z',
  updatedAt: '2026-11-09T00:00:00.000Z',
}

describe('MediaLibraryRemoveDialog', () => {
  it('warns that library.json is deleted and confirms the removal', () => {
    const onConfirm = vi.fn()
    render(<MediaLibraryRemoveDialog library={library} isPending={false} onCancel={vi.fn()} onConfirm={onConfirm} />)

    expect(screen.getByText('mediaLibrary.removeConfirmDescription /Movies/library.json')).toBeTruthy()
    fireEvent.click(screen.getByText('mediaLibrary.remove'))
    expect(onConfirm).toHaveBeenCalledWith(library)
  })

  it('cancels without removing', () => {
    const onCancel = vi.fn()
    const onConfirm = vi.fn()
    render(<MediaLibraryRemoveDialog library={library} isPending={false} onCancel={onCancel} onConfirm={onConfirm} />)

    fireEvent.click(screen.getByText('common.cancel'))
    expect(onCancel).toHaveBeenCalled()
    expect(onConfirm).not.toHaveBeenCalled()
  })

  it('renders nothing without a target', () => {
    render(<MediaLibraryRemoveDialog library={null} isPending={false} onCancel={vi.fn()} onConfirm={vi.fn()} />)
    expect(screen.queryByText('mediaLibrary.removeConfirmTitle')).toBeNull()
  })
})
