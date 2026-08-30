import { afterEach, describe, expect, it, vi } from 'vitest'
import { openNewTab, redirectExternal } from './browser-navigation'

describe('browser navigation', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('redirects the current page through the location API', () => {
    const assign = vi.fn()
    vi.stubGlobal('window', { location: { assign } })

    redirectExternal('https://cloud.example/checkout')

    expect(assign).toHaveBeenCalledWith('https://cloud.example/checkout')
  })

  it('opens external pages in an isolated tab', () => {
    const open = vi.fn()
    vi.stubGlobal('window', { open })

    openNewTab('https://cloud.example/dashboard')

    expect(open).toHaveBeenCalledWith('https://cloud.example/dashboard', '_blank', 'noopener,noreferrer')
  })
})
