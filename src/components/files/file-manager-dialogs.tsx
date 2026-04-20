import type { StorageObject } from '@shared/types'
import { DeleteConfirmDialog } from './dialogs/delete-confirm-dialog'
import { MoveDialog } from './dialogs/move-dialog'
import { NewFolderDialog } from './dialogs/new-folder-dialog'
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
  onDeleteClose: () => void
  onDeleteConfirm: () => void
  deletePending: boolean
  moveTargetIds: string[]
  onMoveClose: () => void
  onMoveConfirm: (targetFolderId: string) => void
  movePending: boolean
  shareTarget: StorageObject | null
  onShareClose: () => void
}

export function FileManagerDialogs(props: FileManagerDialogsProps) {
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
      />

      <ShareDialog
        open={!!props.shareTarget}
        item={props.shareTarget}
        onOpenChange={(open) => {
          if (!open) props.onShareClose()
        }}
      />
    </>
  )
}
