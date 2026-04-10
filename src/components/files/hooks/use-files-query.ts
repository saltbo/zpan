import { useQuery } from '@tanstack/react-query'
import { listObjectsByPath } from '@/lib/api'

const FILES_PAGE_SIZE = 500

export function useFilesQuery(path: string, typeFilter?: string) {
  return useQuery({
    queryKey: ['objects', 'active', 'path', path, typeFilter ?? ''],
    queryFn: () => listObjectsByPath(path, 'active', 1, FILES_PAGE_SIZE, typeFilter),
  })
}
