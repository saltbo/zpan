import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { TooltipProvider } from '@/components/ui/tooltip'
import { ExternalPlayerMenu } from './external-player-menu'

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}))

const toast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }))
vi.mock('sonner', () => ({ toast }))

const URL = 'https://s3.example.com/movie.mkv?X-Amz-Signature=abc'
const MAC_UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 Safari/605.1.15'

function renderMenu(props: { iconOnly?: boolean } = {}) {
  return render(
    <TooltipProvider>
      <ExternalPlayerMenu url={URL} {...props} />
    </TooltipProvider>,
  )
}

function stubClipboard(writeText: (text: string) => Promise<void>) {
  Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true })
}

function openMenu(name: string) {
  fireEvent.pointerDown(screen.getByRole('button', { name }), { button: 0, ctrlKey: false })
}

beforeEach(() => {
  vi.spyOn(navigator, 'userAgent', 'get').mockReturnValue(MAC_UA)
})

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
  toast.success.mockReset()
  toast.error.mockReset()
})

describe('ExternalPlayerMenu', () => {
  it('renders an icon-only toolbar trigger with an accessible label', () => {
    renderMenu({ iconOnly: true })
    const trigger = screen.getByRole('button', { name: 'preview.openWith' })
    expect(trigger.textContent).toBe('preview.openWith')
    expect(trigger.querySelector('.sr-only')).toBeTruthy()
  })

  it('lists the platform players with hand-off links', async () => {
    renderMenu({ iconOnly: true })
    openMenu('preview.openWith')
    const iina = await screen.findByRole('menuitem', { name: 'IINA' })
    expect(iina.getAttribute('href')).toBe(`iina://weblink?url=${encodeURIComponent(URL)}`)
    expect(screen.getByRole('menuitem', { name: 'VLC' }).getAttribute('href')).toBe(`vlc://${URL}`)
    expect(screen.queryByRole('menuitem', { name: 'PotPlayer' })).toBeNull()
  })

  it('copies the media link', async () => {
    const writeText = vi.fn(async () => {})
    stubClipboard(writeText)
    renderMenu()
    openMenu('preview.openWith')
    fireEvent.click(await screen.findByRole('menuitem', { name: 'preview.copyLink' }))
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith('preview.linkCopied'))
    expect(writeText).toHaveBeenCalledWith(URL)
  })

  it('reports a failed copy', async () => {
    stubClipboard(vi.fn(async () => Promise.reject(new Error('denied'))))
    renderMenu()
    openMenu('preview.openWith')
    fireEvent.click(await screen.findByRole('menuitem', { name: 'preview.copyLink' }))
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith('preview.copyLinkFailed'))
  })
})
