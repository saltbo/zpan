import { act, renderHook } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { useCursorPager, useStepBackFromEmptyPage } from './use-cursor-pager'

describe('useCursorPager', () => {
  it('starts on the first page with no token and no previous page', () => {
    const { result } = renderHook(() => useCursorPager('key'))
    expect(result.current.pageToken).toBeUndefined()
    expect(result.current.hasPrevious).toBe(false)
  })

  it('moves forward with a token and back through every visited page', () => {
    const { result } = renderHook(() => useCursorPager('key'))

    act(() => result.current.next('tok-2'))
    expect(result.current.pageToken).toBe('tok-2')
    expect(result.current.hasPrevious).toBe(true)

    act(() => result.current.next('tok-3'))
    expect(result.current.pageToken).toBe('tok-3')

    act(() => result.current.previous())
    expect(result.current.pageToken).toBe('tok-2')
    expect(result.current.hasPrevious).toBe(true)

    act(() => result.current.previous())
    expect(result.current.pageToken).toBeUndefined()
    expect(result.current.hasPrevious).toBe(false)
  })

  it('ignores previous on the first page', () => {
    const { result } = renderHook(() => useCursorPager('key'))
    act(() => result.current.previous())
    expect(result.current.pageToken).toBeUndefined()
    expect(result.current.hasPrevious).toBe(false)
  })

  it('reset returns to the first page', () => {
    const { result } = renderHook(() => useCursorPager('key'))
    act(() => result.current.next('tok-2'))
    act(() => result.current.next('tok-3'))

    act(() => result.current.reset())

    expect(result.current.pageToken).toBeUndefined()
    expect(result.current.hasPrevious).toBe(false)
  })

  it('returns to the first page as soon as the reset key changes', () => {
    const { result, rerender } = renderHook(({ resetKey }) => useCursorPager(resetKey), {
      initialProps: { resetKey: '20:' },
    })
    act(() => result.current.next('tok-2'))
    expect(result.current.pageToken).toBe('tok-2')

    rerender({ resetKey: '50:' })

    expect(result.current.pageToken).toBeUndefined()
    expect(result.current.hasPrevious).toBe(false)

    // Paging works again under the new key, and the old stack is not revived by switching back.
    act(() => result.current.next('tok-b'))
    expect(result.current.pageToken).toBe('tok-b')
    rerender({ resetKey: '20:' })
    expect(result.current.pageToken).toBeUndefined()
  })

  it('keeps its position when re-rendered with the same key', () => {
    const { result, rerender } = renderHook(({ resetKey }) => useCursorPager(resetKey), {
      initialProps: { resetKey: 'same' },
    })
    act(() => result.current.next('tok-2'))
    rerender({ resetKey: 'same' })
    expect(result.current.pageToken).toBe('tok-2')
  })
})

describe('useStepBackFromEmptyPage', () => {
  type Page = { items: string[]; isFetching?: boolean; isPlaceholderData?: boolean }

  // Stands in for a query keyed on the page token: `pages` maps a token (or
  // 'first') to what the query currently reports for it.
  function renderPager(initial: Record<string, Page | undefined>) {
    return renderHook(
      ({ pages }) => {
        const pager = useCursorPager('key')
        const page = pages[pager.pageToken ?? 'first']
        useStepBackFromEmptyPage(pager, {
          data: page && { items: page.items },
          isFetching: page?.isFetching ?? false,
          isPlaceholderData: page?.isPlaceholderData ?? false,
        })
        return pager
      },
      { initialProps: { pages: initial } },
    )
  }

  it('steps back when a later page settles with no rows', () => {
    const { result, rerender } = renderPager({ first: { items: ['a'] }, 'tok-2': { items: ['b'] } })
    act(() => result.current.next('tok-2'))
    expect(result.current.pageToken).toBe('tok-2')

    rerender({ pages: { first: { items: ['a'] }, 'tok-2': { items: [] } } })

    expect(result.current.pageToken).toBeUndefined()
    expect(result.current.hasPrevious).toBe(false)
  })

  it('keeps walking back while each earlier page is empty too', () => {
    const { result, rerender } = renderPager({
      first: { items: ['a'] },
      'tok-2': { items: ['b'] },
      'tok-3': { items: ['c'] },
    })
    act(() => result.current.next('tok-2'))
    act(() => result.current.next('tok-3'))

    rerender({ pages: { first: { items: ['a'] }, 'tok-2': { items: [] }, 'tok-3': { items: [] } } })

    expect(result.current.pageToken).toBeUndefined()
  })

  it('leaves an empty first page alone', () => {
    const { result } = renderPager({ first: { items: [] } })
    expect(result.current.pageToken).toBeUndefined()
    expect(result.current.hasPrevious).toBe(false)
  })

  it('stays on a later page that still has rows', () => {
    const { result } = renderPager({ first: { items: ['a'] }, 'tok-2': { items: ['b'] } })
    act(() => result.current.next('tok-2'))
    expect(result.current.pageToken).toBe('tok-2')
  })

  it('waits for the page to load before judging it', () => {
    const { result, rerender } = renderPager({ first: { items: ['a'] } })
    act(() => result.current.next('tok-2'))
    expect(result.current.pageToken).toBe('tok-2')

    rerender({ pages: { first: { items: ['a'] }, 'tok-2': { items: ['b'] } } })
    expect(result.current.pageToken).toBe('tok-2')
  })

  it('ignores empty rows kept from the page before while the next one loads', () => {
    const { result } = renderPager({
      first: { items: ['a'] },
      'tok-2': { items: [], isFetching: true, isPlaceholderData: true },
    })
    act(() => result.current.next('tok-2'))
    expect(result.current.pageToken).toBe('tok-2')
  })

  it('ignores a cached empty page while it is being refetched', () => {
    const { result, rerender } = renderPager({
      first: { items: ['a'] },
      'tok-2': { items: [], isFetching: true },
    })
    act(() => result.current.next('tok-2'))
    expect(result.current.pageToken).toBe('tok-2')

    rerender({ pages: { first: { items: ['a'] }, 'tok-2': { items: ['b'] } } })
    expect(result.current.pageToken).toBe('tok-2')
  })
})
