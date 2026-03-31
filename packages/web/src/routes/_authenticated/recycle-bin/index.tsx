import { createFileRoute } from '@tanstack/react-router'
import { Trash2 } from 'lucide-react'

export const Route = createFileRoute('/_authenticated/recycle-bin/')({
  component: RecycleBinPage,
})

function RecycleBinPage() {
  return (
    <div className="flex flex-col items-center justify-center gap-4 py-20 text-muted-foreground">
      <Trash2 className="h-16 w-16" />
      <h2 className="text-xl font-medium">Recycle Bin</h2>
      <p className="text-sm">Deleted files will appear here. (GET /api/objects?status=trashed)</p>
    </div>
  )
}
