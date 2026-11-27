import { cleanup, render, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createObject } from '@/lib/api'
import { UploadQueueProvider, UploadStatusButton, useUploadQueue } from './upload-queue'

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, opts?: Record<string, unknown>) => (opts ? `${key}:${JSON.stringify(opts)}` : key),
  }),
}))

vi.mock('lucide-react', () => ({
  CheckCircle2: () => <span data-testid="check-icon" />,
  Loader2: () => <span data-testid="loader-icon" />,
  UploadCloud: () => <span data-testid="upload-icon" />,
  X: () => <span data-testid="cancel-icon" />,
  XCircle: () => <span data-testid="x-circle-icon" />,
}))

vi.mock('@/components/ui/popover', () => ({
  Popover: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  PopoverTrigger: ({ children }: { children: ReactNode }) => <>{children}</>,
  PopoverContent: ({ children, className }: { children: ReactNode; className?: string }) => (
    <div data-testid="upload-popover" className={className}>
      {children}
    </div>
  ),
}))

function EnqueueLongFile() {
  const queue = useUploadQueue()
  return (
    <button
      type="button"
      onClick={() =>
        queue.enqueue([
          {
            file: new File(['content'], 'really-long-file-name-that-should-not-overflow-the-uploader-panel.txt', {
              type: 'text/plain',
            }),
            run: async (ctx) => {
              ctx.setStatus('uploading')
              ctx.onProgress({ loaded: 3, total: 7 })
              await new Promise(() => undefined)
            },
          },
        ])
      }
    >
      enqueue
    </button>
  )
}

const CAPACITY_MESSAGE = '此空间的存储空间不足，无法上传该文件。升级存储后即可继续。'

function EnqueueOverQuotaFile() {
  const queue = useUploadQueue()
  return (
    <button
      type="button"
      onClick={() =>
        queue.enqueue([
          {
            file: new File(['content'], 'big.bin'),
            run: async () => {
              await createObject({ name: 'big.bin', size: 7, parent: '', dirtype: 0 })
            },
          },
        ])
      }
    >
      enqueue
    </button>
  )
}

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

describe('UploadStatusButton', () => {
  it('renders the uploader icon and empty state when there are no tasks', () => {
    const { getByLabelText, getByText } = render(
      <UploadQueueProvider>
        <UploadStatusButton />
      </UploadQueueProvider>,
    )

    expect(getByLabelText('uploadPanel.toggle')).toBeTruthy()
    expect(getByText('uploadPanel.empty')).toBeTruthy()
  })

  it('uses constrained popover and truncating file row layout for long names', async () => {
    const { getByText, getByTestId } = render(
      <UploadQueueProvider>
        <EnqueueLongFile />
        <UploadStatusButton />
      </UploadQueueProvider>,
    )

    getByText('enqueue').click()

    await waitFor(() =>
      expect(getByText('really-long-file-name-that-should-not-overflow-the-uploader-panel.txt')).toBeTruthy(),
    )

    const popover = getByTestId('upload-popover')
    expect(popover.className).toContain('max-h-[min(28rem,calc(100vh-4rem))]')
    expect(popover.className).toContain('overflow-hidden')

    const filename = getByText('really-long-file-name-that-should-not-overflow-the-uploader-panel.txt')
    expect(filename.className).toContain('min-w-0')
    expect(filename.className).toContain('flex-1')
    expect(filename.className).toContain('truncate')
    expect(filename.closest('.min-w-0')).toBeTruthy()
    expect(filename.closest('.overflow-y-auto')).toBeTruthy()
    expect(filename.closest('.overflow-x-hidden')).toBeTruthy()
  })

  it('shows the server message for an over-quota upload, never the reason code [spec: objects/create-capacity-message]', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            error: {
              code: 402,
              message: CAPACITY_MESSAGE,
              status: 'RESOURCE_EXHAUSTED',
              details: [
                {
                  '@type': 'type.googleapis.com/google.rpc.ErrorInfo',
                  reason: 'CAPACITY_REQUIRED',
                  domain: 'zpan.dev',
                },
              ],
            },
            requestHash: 'a'.repeat(64),
            requestedBytes: 7,
            usedBytes: 90,
            quotaBytes: 100,
            offers: [],
          }),
          { status: 402, headers: { 'Content-Type': 'application/json' } },
        ),
      ),
    )
    const { getByText, queryByText } = render(
      <UploadQueueProvider>
        <EnqueueOverQuotaFile />
        <UploadStatusButton />
      </UploadQueueProvider>,
    )

    getByText('enqueue').click()

    await waitFor(() => expect(getByText(CAPACITY_MESSAGE)).toBeTruthy())
    expect(queryByText(/CAPACITY_REQUIRED/)).toBeNull()
  })
})
