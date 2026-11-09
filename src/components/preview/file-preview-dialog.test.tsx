import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { TooltipProvider } from '@/components/ui/tooltip'
import { FilePreviewDialog } from './file-preview-dialog'

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}))

const isMobile = vi.hoisted(() => ({ value: false }))
vi.mock('@/hooks/use-mobile', () => ({ useIsMobile: () => isMobile.value }))

vi.mock('./file-preview-content', () => ({
  FilePreviewContent: () => <div data-testid="preview-content" />,
  PreviewDownloadButton: () => <button type="button">preview.download</button>,
}))

class TestResizeObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
}
globalThis.ResizeObserver ??= TestResizeObserver as unknown as typeof ResizeObserver

afterEach(() => {
  cleanup()
  isMobile.value = false
})

function file(name: string, type: string) {
  return { id: '1', name, type, size: 1024, downloadUrl: `https://s3.example.com/${name}` }
}

function renderDialog(name: string, type: string) {
  return render(
    <TooltipProvider>
      <FilePreviewDialog file={file(name, type)} open onOpenChange={() => {}} />
    </TooltipProvider>,
  )
}

describe('FilePreviewDialog', () => {
  it('offers external players in the header for videos', () => {
    renderDialog('movie.mkv', 'video/x-matroska')
    expect(screen.getByRole('button', { name: 'preview.openWith' })).toBeTruthy()
  })

  it('does not offer external players for other previews', () => {
    renderDialog('report.pdf', 'application/pdf')
    expect(screen.queryByRole('button', { name: 'preview.openWith' })).toBeNull()
  })

  it('sizes video dialogs past the default sm:max-w-lg cap', () => {
    renderDialog('movie.mp4', 'video/mp4')
    const dialog = screen.getByRole('dialog')
    expect(dialog.className).toContain('sm:max-w-none')
    expect(dialog.className).toContain('w-[min(92vw,1280px,calc((90dvh_-_4rem)*16/9))]')
  })

  it.each([
    ['song.mp3', 'audio/mpeg', 'sm:max-w-md'],
    ['report.pdf', 'application/pdf', 'sm:max-w-4xl'],
    ['notes.md', 'text/markdown', 'sm:max-w-5xl'],
    ['archive.zip', 'application/zip', 'sm:max-w-3xl'],
  ])('applies the %s width at the same breakpoint as the default cap', (name, type, width) => {
    renderDialog(name, type)
    expect(screen.getByRole('dialog').className).toContain(width)
  })

  it('shows the header menu on mobile too', () => {
    isMobile.value = true
    renderDialog('movie.mkv', 'video/x-matroska')
    expect(screen.getByRole('button', { name: 'preview.openWith' })).toBeTruthy()
  })
})
