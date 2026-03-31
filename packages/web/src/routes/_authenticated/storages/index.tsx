import { createFileRoute } from '@tanstack/react-router'
import { Database } from 'lucide-react'

export const Route = createFileRoute('/_authenticated/storages/')({
  component: StoragesPage,
})

function StoragesPage() {
  return (
    <div className="flex flex-col items-center justify-center gap-4 py-20 text-muted-foreground">
      <Database className="h-16 w-16" />
      <h2 className="text-xl font-medium">Storage Backends</h2>
      <p className="text-sm">Configure your S3-compatible storage backends here.</p>
    </div>
  )
}
