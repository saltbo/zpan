import { cleanup, render, screen } from '@testing-library/react'
import type React from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { OperationProgressState } from './dialogs/operation-progress'
import { FileManagerDialogs } from './file-manager-dialogs'

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}))

vi.mock('@tanstack/react-router', () => ({
  useNavigate: () => vi.fn(),
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

vi.mock('./dialogs/rename-dialog', () => ({
  RenameDialog: () => null,
}))

vi.mock('./dialogs/new-folder-dialog', () => ({
  NewFolderDialog: () => null,
}))

vi.mock('./dialogs/name-conflict-dialog', () => ({
  NameConflictDialog: () => null,
}))

vi.mock('./dialogs/share-dialog', () => ({
  ShareDialog: () => null,
}))

vi.mock('./dialogs/delete-confirm-dialog', () => ({
  DeleteConfirmDialog: () => null,
}))

vi.mock('./dialogs/move-dialog', () => ({
  MoveDialog: () => null,
}))

afterEach(cleanup)

function failedOperation(): OperationProgressState {
  return {
    title: 'Restore',
    total: 2,
    completed: 2,
    currentName: '',
    cancelRequested: false,
    finished: true,
    failures: [{ name: 'Archive', message: 'Permission denied' }],
  }
}

describe('FileManagerDialogs', () => {
  it('shows failure details in the generic batch operation dialog', () => {
    render(
      <FileManagerDialogs
        renameTarget={null}
        onRenameClose={vi.fn()}
        onRenameConfirm={vi.fn()}
        renamePending={false}
        showNewFolder={false}
        onNewFolderClose={vi.fn()}
        onNewFolderConfirm={vi.fn()}
        newFolderPending={false}
        deleteTargetIds={[]}
        operation={failedOperation()}
        onOperationCancel={vi.fn()}
        onOperationDismiss={vi.fn()}
        onDeleteClose={vi.fn()}
        onDeleteConfirm={vi.fn()}
        deletePending={false}
        moveTargetIds={[]}
        onMoveClose={vi.fn()}
        onMoveConfirm={vi.fn()}
        movePending={false}
        shareTarget={null}
        onShareClose={vi.fn()}
        conflictDialogState={{
          request: null,
          applyToAll: false,
          onApplyToAllChange: vi.fn(),
          onChoose: vi.fn(),
          onCancel: vi.fn(),
        }}
      />,
    )

    expect(screen.getAllByText('Restore').length).toBeGreaterThan(0)
    expect(screen.getByText('Archive')).toBeTruthy()
    expect(screen.getByText('Permission denied')).toBeTruthy()
    expect(screen.getByText('common.close')).toBeTruthy()
  })
})
