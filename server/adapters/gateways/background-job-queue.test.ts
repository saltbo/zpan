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
