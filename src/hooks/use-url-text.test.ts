import { act, renderHook } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { useUrlText } from './use-url-text'

describe('useUrlText', () => {
  it('keeps every keystroke while earlier URL updates are still landing [spec: list-state/search-typing]', () => {
    const writeToUrl = vi.fn()
    const { result, rerender } = renderHook(({ url }) => useUrlText(url, writeToUrl), { initialProps: { url: '' } })

    act(() => result.current[1]('a'))
    act(() => result.current[1]('ad'))
    act(() => result.current[1]('adm'))
    rerender({ url: 'a' })
    expect(result.current[0]).toBe('adm')
    rerender({ url: 'adm' })
    expect(result.current[0]).toBe('adm')
    expect(writeToUrl.mock.calls.map(([value]) => value)).toEqual(['a', 'ad', 'adm'])
  })

  it('takes the URL value when it changes from elsewhere, such as back', () => {
    const { result, rerender } = renderHook(({ url }) => useUrlText(url, vi.fn()), { initialProps: { url: 'ali' } })
    expect(result.current[0]).toBe('ali')

    act(() => result.current[1]('alic'))
    rerender({ url: 'alic' })
    rerender({ url: '' })
    expect(result.current[0]).toBe('')
  })
})
