import { createFileRoute } from '@tanstack/react-router'
import { FolderOpen } from 'lucide-react'

export const Route = createFileRoute('/_authenticated/files/')({
  component: FilesPage,
})

function FilesPage() {
  return (
    <div className="flex flex-col items-center justify-center gap-4 py-20 text-muted-foreground">
      <FolderOpen className="h-16 w-16" />
      <h2 className="text-xl font-medium">Files</h2>
      <p className="text-sm">File manager will be implemented here.</p>
    </div>
  )
}
