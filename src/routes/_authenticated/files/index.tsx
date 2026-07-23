import { createFileRoute, useSearch } from '@tanstack/react-router'
import { FileManager } from '@/components/files/file-manager'

interface FilesSearch {
  path?: string
  type?: string
}

export const Route = createFileRoute('/_authenticated/files/')({
  validateSearch: (search: Record<string, unknown>): FilesSearch => ({
    path: (search.path as string) || undefined,
    type: (search.type as string) || undefined,
  }),
  component: FilesPage,
})

function FilesPage() {
  const { path, type } = useSearch({ from: '/_authenticated/files/' })
  return <FileManager initialPath={path} filterType={type} />
}
