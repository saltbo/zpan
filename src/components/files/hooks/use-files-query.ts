import { useInfiniteQuery } from '@tanstack/react-query'
import { listObjectsByPath } from '@/lib/api'

const FILES_PAGE_SIZE = 100

export function useFilesQuery(path: string, typeFilter?: string, search?: string) {
  const query = useInfiniteQuery({
    queryKey: ['objects', 'active', 'path', path, typeFilter ?? '', search ?? ''],
    queryFn: ({ pageParam }) => listObjectsByPath(path, pageParam, FILES_PAGE_SIZE, { type: typeFilter, search }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (lastPage) => lastPage.nextPageToken ?? undefined,
  })
  return {
    ...query,
    data: query.data ? { items: query.data.pages.flatMap((page) => page.items) } : undefined,
  }
}
