// Tests for src/hooks/use-clipboard.ts
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

vi.mock('sonner', () => ({ toast: { success: vi.fn() } }))
vi.mock('i18next', () => ({
  default: { t: vi.fn((key: string) => `translated:${key}`) },
}))

import i18next from 'i18next'
import { toast } from 'sonner'
import { useClipboard } from './use-clipboard'

function makeClipboardStub() {
  return { writeText: vi.fn().mockResolvedValue(undefined) }
}

describe('useClipboard', () => {
  let clipboardStub: ReturnType<typeof makeClipboardStub>

  beforeEach(() => {
    clipboardStub = makeClipboardStub()
    vi.stubGlobal('navigator', { clipboard: clipboardStub })
    vi.mocked(toast.success).mockClear()
    vi.mocked(i18next.t).mockClear()
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('returns a copy function', () => {
    const { copy } = useClipboard()

    expect(typeof copy).toBe('function')
  })

  it('calls navigator.clipboard.writeText with the provided text', async () => {
    const { copy } = useClipboard()

    await copy('hello world')

    expect(clipboardStub.writeText).toHaveBeenCalledWith('hello world')
    expect(clipboardStub.writeText).toHaveBeenCalledTimes(1)
  })

  it('calls toast.success after writing to clipboard', async () => {
    const { copy } = useClipboard()

    await copy('some text')

    expect(toast.success).toHaveBeenCalledTimes(1)
  })

  it('calls i18next.t with the default key "common.copied" when no key provided', async () => {
    const { copy } = useClipboard()

    await copy('some text')

    expect(i18next.t).toHaveBeenCalledWith('common.copied')
  })

  it('passes translated text to toast.success', async () => {
    const { copy } = useClipboard()
    vi.mocked(i18next.t).mockReturnValueOnce('Copied!')

    await copy('some text')

    expect(toast.success).toHaveBeenCalledWith('Copied!')
  })

  it('uses a custom successKey when provided', async () => {
    const { copy } = useClipboard()

    await copy('some text', 'ihost.copy.copied')

    expect(i18next.t).toHaveBeenCalledWith('ihost.copy.copied')
  })

  it('calls i18next.t with the custom key, not the default', async () => {
    const { copy } = useClipboard()

    await copy('my text', 'custom.key')

    expect(i18next.t).not.toHaveBeenCalledWith('common.copied')
    expect(i18next.t).toHaveBeenCalledWith('custom.key')
  })

  it('writes different text values correctly', async () => {
    const { copy } = useClipboard()

    await copy('https://example.com/image.png')

    expect(clipboardStub.writeText).toHaveBeenCalledWith('https://example.com/image.png')
  })
})
