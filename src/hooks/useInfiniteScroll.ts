import { type RefObject, useEffect, useRef } from 'react'

interface InfiniteScrollOptions {
  hasNextPage: boolean
  isFetchingNextPage: boolean
  fetchNextPage: () => Promise<unknown>
  rootRef?: RefObject<Element | null>
  rootSelector?: string
  rootMargin?: string
}

export function useInfiniteScroll<T extends Element>({
  hasNextPage,
  isFetchingNextPage,
  fetchNextPage,
  rootRef,
  rootSelector,
  rootMargin = '320px 0px',
}: InfiniteScrollOptions) {
  const loadMoreRef = useRef<T>(null)

  useEffect(() => {
    const target = loadMoreRef.current
    if (!target || !hasNextPage) return
    const root = rootSelector ? rootRef?.current?.querySelector(rootSelector) : rootRef?.current
    if (rootRef && !root) return

    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting && !isFetchingNextPage) void fetchNextPage()
      },
      { root: root ?? null, rootMargin },
    )
    observer.observe(target)
    return () => observer.disconnect()
  }, [fetchNextPage, hasNextPage, isFetchingNextPage, rootMargin, rootRef, rootSelector])

  return loadMoreRef
}
