import { describe, expect, it, vi } from 'vitest'
import type { Platform } from '../../platform/interface'
import type { BackgroundJobMessage } from '../../usecases/ports'
import { BACKGROUND_JOB_QUEUE_BINDING, createBackgroundJobQueue } from './background-job-queue'

function message(jobId: string): BackgroundJobMessage {
  return {
    jobId,
    orgId: 'org-1',
    userId: 'user-1',
    createdBy: { type: 'system', ref: null, issuer: null },
    request: { type: 'media_library_scan', libraryId: `lib-${jobId}` },
  }
}

function platformWith(bindings: Record<string, unknown>): Platform {
  return { db: {} as Platform['db'], getEnv: () => undefined, getBinding: <T>(key: string) => bindings[key] as T }
}

describe('createBackgroundJobQueue dispatchBatch', () => {
  it('sends every message in one sendBatch call on the queue binding', async () => {
    const queue = { send: vi.fn(), sendBatch: vi.fn(async () => {}) }
    const run = vi.fn(async () => {})
    const jobs = createBackgroundJobQueue(platformWith({ [BACKGROUND_JOB_QUEUE_BINDING]: queue }), run)

    await jobs.dispatchBatch([message('a'), message('b')])

    expect(queue.sendBatch).toHaveBeenCalledExactlyOnceWith([{ body: message('a') }, { body: message('b') }])
    expect(queue.send).not.toHaveBeenCalled()
    expect(run).not.toHaveBeenCalled()
  })

  it('runs each message in process, in order, when there is no queue binding', async () => {
    const ran: string[] = []
    const jobs = createBackgroundJobQueue(platformWith({}), async (next) => {
      ran.push(next.jobId)
    })

    await jobs.dispatchBatch([message('a'), message('b')])
    await vi.waitFor(() => expect(ran).toEqual(['a', 'b']))
  })
})

describe('createBackgroundJobQueue dispatch', () => {
  it('passes a delay to the queue binding [spec: media-scraping/rate-limited]', async () => {
    const queue = { send: vi.fn(async () => {}), sendBatch: vi.fn() }
    const jobs = createBackgroundJobQueue(platformWith({ [BACKGROUND_JOB_QUEUE_BINDING]: queue }), vi.fn())

    await jobs.dispatch(message('a'))
    await jobs.dispatch(message('b'), { delaySeconds: 30 })

    expect(queue.send.mock.calls).toEqual([
      [message('a'), undefined],
      [message('b'), { delaySeconds: 30 }],
    ])
  })

  it('holds a delayed message back in process [spec: media-scraping/rate-limited]', async () => {
    vi.useFakeTimers()
    try {
      const ran: string[] = []
      const jobs = createBackgroundJobQueue(platformWith({}), async (next) => {
        ran.push(next.jobId)
      })

      await jobs.dispatch(message('late'), { delaySeconds: 5 })
      await vi.advanceTimersByTimeAsync(4_999)
      expect(ran).toEqual([])
      // The delay pushes the message; the queue then drains on its next tick.
      await vi.advanceTimersByTimeAsync(2)
      expect(ran).toEqual(['late'])
    } finally {
      vi.useRealTimers()
    }
  })
})
