import { act, renderHook } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { useCursorPager } from './use-cursor-pager'

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
