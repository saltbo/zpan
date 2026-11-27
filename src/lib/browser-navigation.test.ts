import { afterEach, describe, expect, it, vi } from 'vitest'
import { openNewTab, redirectExternal, startDownload } from './browser-navigation'

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

  it('starts a download by clicking a hidden link in the current tab', () => {
    const link = { href: '', rel: '', style: { display: '' }, click: vi.fn(), remove: vi.fn() }
    const appendChild = vi.fn()
    vi.stubGlobal('document', { createElement: vi.fn(() => link), body: { appendChild } })

    startDownload('https://s3.example/bt/file.mkv?sig=1')

    expect(link).toMatchObject({ href: 'https://s3.example/bt/file.mkv?sig=1', rel: 'noopener' })
    expect(appendChild).toHaveBeenCalledWith(link)
    expect(link.click).toHaveBeenCalledOnce()
    expect(link.remove).toHaveBeenCalledOnce()
  })
})
