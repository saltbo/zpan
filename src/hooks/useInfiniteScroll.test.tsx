import { render } from '@testing-library/react'
import { useRef } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useInfiniteScroll } from './useInfiniteScroll'

class IntersectionObserverStub {
  static instances: IntersectionObserverStub[] = []

  readonly observe = vi.fn()
  readonly disconnect = vi.fn()

  constructor(
    readonly callback: IntersectionObserverCallback,
    readonly options?: IntersectionObserverInit,
  ) {
    IntersectionObserverStub.instances.push(this)
  }

  intersect(isIntersecting: boolean) {
    this.callback([{ isIntersecting } as IntersectionObserverEntry], this as unknown as IntersectionObserver)
  }
}

function Harness(props: { hasNextPage: boolean; isFetchingNextPage: boolean; fetchNextPage: () => Promise<unknown> }) {
  const ref = useInfiniteScroll<HTMLDivElement>(props)
  return <div ref={ref}>Load more</div>
}

function RootHarness(props: { fetchNextPage: () => Promise<unknown> }) {
  const rootRef = useRef<HTMLElement>(null)
  const ref = useInfiniteScroll<HTMLSpanElement>({
    hasNextPage: true,
    isFetchingNextPage: false,
    fetchNextPage: props.fetchNextPage,
    rootRef,
    rootSelector: '[data-scroll-root]',
    rootMargin: '240px 0px',
  })
  return (
    <section ref={rootRef}>
      <div data-scroll-root>
        <span ref={ref}>Load more</span>
      </div>
    </section>
  )
}

beforeEach(() => {
  IntersectionObserverStub.instances = []
  vi.stubGlobal('IntersectionObserver', IntersectionObserverStub)
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('useInfiniteScroll', () => {
  it('observes the sentinel and loads the next page when it intersects', () => {
    const fetchNextPage = vi.fn().mockResolvedValue(undefined)
    const { unmount } = render(<Harness hasNextPage={true} isFetchingNextPage={false} fetchNextPage={fetchNextPage} />)
    const [observer] = IntersectionObserverStub.instances

    expect(observer?.options).toEqual({ root: null, rootMargin: '320px 0px' })
    expect(observer?.observe).toHaveBeenCalledOnce()

    observer?.intersect(false)
    expect(fetchNextPage).not.toHaveBeenCalled()

    observer?.intersect(true)
    expect(fetchNextPage).toHaveBeenCalledOnce()

    unmount()
    expect(observer?.disconnect).toHaveBeenCalledOnce()
  })

  it('does not observe without another page or load concurrently', () => {
    const fetchNextPage = vi.fn().mockResolvedValue(undefined)
    const { rerender } = render(
      <Harness hasNextPage={false} isFetchingNextPage={false} fetchNextPage={fetchNextPage} />,
    )

    expect(IntersectionObserverStub.instances).toHaveLength(0)

    rerender(<Harness hasNextPage={true} isFetchingNextPage={true} fetchNextPage={fetchNextPage} />)
    IntersectionObserverStub.instances[0]?.intersect(true)

    expect(fetchNextPage).not.toHaveBeenCalled()
  })

  it('supports a nested scroll container', () => {
    const fetchNextPage = vi.fn().mockResolvedValue(undefined)

    render(<RootHarness fetchNextPage={fetchNextPage} />)

    const [observer] = IntersectionObserverStub.instances
    expect(observer?.options?.rootMargin).toBe('240px 0px')
    expect((observer?.options?.root as Element).hasAttribute('data-scroll-root')).toBe(true)
  })
})
