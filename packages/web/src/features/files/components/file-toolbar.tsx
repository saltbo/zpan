import { useState } from 'react'
import { Upload, FolderPlus, Search, Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog'

interface FileToolbarProps {
  search: string
  onSearchChange: (value: string) => void
  onUploadClick: () => void
  onCreateFolder: (name: string) => void
  selectedCount: number
  onBatchTrash: () => void
}

export function FileToolbar({
  search,
  onSearchChange,
  onUploadClick,
  onCreateFolder,
  selectedCount,
  onBatchTrash,
}: FileToolbarProps) {
  const [folderDialogOpen, setFolderDialogOpen] = useState(false)
  const [folderName, setFolderName] = useState('')

  function handleCreateFolder() {
    const name = folderName.trim()
    if (!name) return
    onCreateFolder(name)
    setFolderName('')
    setFolderDialogOpen(false)
  }

  return (
    <>
      <div className="flex items-center gap-2">
        <Button size="sm" onClick={onUploadClick}>
          <Upload className="mr-1 h-4 w-4" />
          Upload
        </Button>
        <Button size="sm" variant="outline" onClick={() => setFolderDialogOpen(true)}>
          <FolderPlus className="mr-1 h-4 w-4" />
          New Folder
        </Button>

        <div className="relative ml-auto w-64">
          <Search className="absolute left-2 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            placeholder="Search files..."
            value={search}
            onChange={(e) => onSearchChange(e.target.value)}
            className="pl-8 h-8"
          />
        </div>

        {selectedCount > 0 && (
          <div className="flex items-center gap-2 border-l pl-2 ml-2">
            <span className="text-sm text-muted-foreground">{selectedCount} selected</span>
            <Button size="sm" variant="destructive" onClick={onBatchTrash}>
              <Trash2 className="mr-1 h-4 w-4" />
              Delete
            </Button>
          </div>
        )}
      </div>

      <Dialog open={folderDialogOpen} onOpenChange={setFolderDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>New Folder</DialogTitle>
          </DialogHeader>
          <Input
            placeholder="Folder name"
            value={folderName}
            onChange={(e) => setFolderName(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleCreateFolder()}
            autoFocus
          />
          <DialogFooter>
            <Button variant="outline" onClick={() => setFolderDialogOpen(false)}>
              Cancel
            </Button>
            <Button onClick={handleCreateFolder} disabled={!folderName.trim()}>
              Create
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}
