import type { StorageObject } from '@shared/types'
import { useNavigate } from '@tanstack/react-router'
import type { ComponentProps } from 'react'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { DeleteConfirmDialog } from './dialogs/delete-confirm-dialog'
import { MoveDialog } from './dialogs/move-dialog'
import { NameConflictDialog } from './dialogs/name-conflict-dialog'
import { NewFolderDialog } from './dialogs/new-folder-dialog'
import { OperationProgress, type OperationProgressState } from './dialogs/operation-progress'
import { RenameDialog } from './dialogs/rename-dialog'
import { ShareDialog } from './dialogs/share-dialog'

interface FileManagerDialogsProps {
  renameTarget: StorageObject | null
  onRenameClose: () => void
  onRenameConfirm: (name: string) => void
  renamePending: boolean
  showNewFolder: boolean
  onNewFolderClose: () => void
  onNewFolderConfirm: (name: string) => void
  newFolderPending: boolean
  deleteTargetIds: string[]
  operation: OperationProgressState | null
  onOperationCancel: () => void
  onOperationDismiss: () => void
  onDeleteClose: () => void
  onDeleteConfirm: () => void
  deletePending: boolean
  moveTargetIds: string[]
  onMoveClose: () => void
  onMoveConfirm: (targetFolderId: string) => void
  movePending: boolean
  shareTarget: StorageObject | null
  onShareClose: () => void
  conflictDialogState: ComponentProps<typeof NameConflictDialog>
}

export function FileManagerDialogs(props: FileManagerDialogsProps) {
  const navigate = useNavigate()
  return (
    <>
      <RenameDialog
        open={!!props.renameTarget}
        currentName={props.renameTarget?.name ?? ''}
        onOpenChange={(open) => {
          if (!open) props.onRenameClose()
        }}
        onConfirm={props.onRenameConfirm}
        isPending={props.renamePending}
      />

      <NewFolderDialog
        open={props.showNewFolder}
        onOpenChange={(open) => {
          if (!open) props.onNewFolderClose()
        }}
        onConfirm={props.onNewFolderConfirm}
        isPending={props.newFolderPending}
      />

      <DeleteConfirmDialog
        open={props.deleteTargetIds.length > 0}
        count={props.deleteTargetIds.length}
        operation={props.deleteTargetIds.length > 0 ? props.operation : null}
        onCancelOperation={props.onOperationCancel}
        onDismissOperation={props.onOperationDismiss}
        onOpenChange={(open) => {
          if (!open) props.onDeleteClose()
        }}
        onConfirm={props.onDeleteConfirm}
        isPending={props.deletePending}
      />

      <MoveDialog
        open={props.moveTargetIds.length > 0}
        onOpenChange={(open) => {
          if (!open) props.onMoveClose()
        }}
        onConfirm={props.onMoveConfirm}
        isPending={props.movePending}
        excludeIds={props.moveTargetIds}
        operation={props.moveTargetIds.length > 0 ? props.operation : null}
        onCancelOperation={props.onOperationCancel}
        onDismissOperation={props.onOperationDismiss}
      />

      <Dialog open={!!props.operation && props.deleteTargetIds.length === 0 && props.moveTargetIds.length === 0}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{props.operation?.title}</DialogTitle>
          </DialogHeader>
          {props.operation && (
            <OperationProgress
              operation={props.operation}
              onCancel={props.onOperationCancel}
              onClose={props.onOperationDismiss}
            />
          )}
        </DialogContent>
      </Dialog>

      <NameConflictDialog {...props.conflictDialogState} />

      <ShareDialog
        open={!!props.shareTarget}
        item={props.shareTarget}
        onOpenChange={(open) => {
          if (!open) props.onShareClose()
        }}
        onViewShares={() => {
          props.onShareClose()
          navigate({ to: '/shares', search: { status: 'all', page: 1 } })
        }}
      />
    </>
  )
}
