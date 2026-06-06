import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import type React from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { DeleteConfirmDialog } from './delete-confirm-dialog'
import { MoveDialog } from './move-dialog'
import { OperationProgress, type OperationProgressState } from './operation-progress'

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}))

vi.mock('@/components/ui/dialog', () => ({
  Dialog: ({ open, children }: { open?: boolean; children: React.ReactNode }) => (open ? <div>{children}</div> : null),
  DialogContent: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DialogDescription: ({ children }: { children: React.ReactNode }) => <p>{children}</p>,
  DialogFooter: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DialogHeader: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DialogTitle: ({ children }: { children: React.ReactNode }) => <h2>{children}</h2>,
}))

vi.mock('@/components/ui/progress', () => ({
  Progress: ({ value }: { value?: number }) => <div data-testid="progress">{value}</div>,
}))

vi.mock('../hooks/use-files-query', () => ({
  useFilesQuery: () => ({ data: { items: [] }, isLoading: false }),
}))

afterEach(cleanup)

function failedOperation(): OperationProgressState {
  return {
    title: 'Move',
    total: 3,
    completed: 3,
    currentName: '',
    cancelRequested: false,
    finished: true,
    failures: [
      { name: 'Budget.xlsx', message: 'Name already exists' },
      { name: 'Archive', message: 'Permission denied' },
    ],
  }
}

describe('OperationProgress', () => {
  it('renders each failed item with its error reason', () => {
    render(<OperationProgress operation={failedOperation()} onCancel={vi.fn()} onClose={vi.fn()} />)

    expect(screen.getByText('Budget.xlsx')).toBeTruthy()
    expect(screen.getByText('Name already exists')).toBeTruthy()
    expect(screen.getByText('Archive')).toBeTruthy()
    expect(screen.getByText('Permission denied')).toBeTruthy()
    expect(screen.getByText('common.close')).toBeTruthy()
  })

  it('calls onClose from the finished failure state', () => {
    const onClose = vi.fn()
    render(<OperationProgress operation={failedOperation()} onCancel={vi.fn()} onClose={onClose} />)

    fireEvent.click(screen.getByText('common.close'))

    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('keeps cancel available while the operation is still running', () => {
    const onCancel = vi.fn()
    render(
      <OperationProgress
        operation={{ ...failedOperation(), finished: false, completed: 1, failures: [] }}
        onCancel={onCancel}
        onClose={vi.fn()}
      />,
    )

    fireEvent.click(screen.getByText('common.cancel'))

    expect(onCancel).toHaveBeenCalledTimes(1)
  })
})

describe('DeleteConfirmDialog', () => {
  it('shows failure details inside the delete dialog execution state', () => {
    render(
      <DeleteConfirmDialog
        open
        count={3}
        isPending
        operation={failedOperation()}
        onCancelOperation={vi.fn()}
        onDismissOperation={vi.fn()}
        onConfirm={vi.fn()}
        onOpenChange={vi.fn()}
      />,
    )

    expect(screen.getByText('files.trashConfirmTitle')).toBeTruthy()
    expect(screen.getByText('Budget.xlsx')).toBeTruthy()
    expect(screen.getByText('Permission denied')).toBeTruthy()
    expect(screen.queryByText('files.trashConfirmDescription')).toBeNull()
  })
})

describe('MoveDialog', () => {
  it('shows failure details inside the move dialog execution state', () => {
    render(
      <MoveDialog
        open
        isPending
        operation={failedOperation()}
        onCancelOperation={vi.fn()}
        onDismissOperation={vi.fn()}
        excludeIds={[]}
        onConfirm={vi.fn()}
        onOpenChange={vi.fn()}
      />,
    )

    expect(screen.getByText('files.moveTo')).toBeTruthy()
    expect(screen.getByText('Budget.xlsx')).toBeTruthy()
    expect(screen.getByText('Name already exists')).toBeTruthy()
    expect(screen.queryByText('files.noFolders')).toBeNull()
  })
})
