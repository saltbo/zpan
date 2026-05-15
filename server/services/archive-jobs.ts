import type { CreateBackgroundJobRequest } from '@shared/schemas'
import type { Platform } from '../platform/interface'
import { processArchiveJob } from './archive-processing'

export const ARCHIVE_QUEUE_BINDING = 'ARCHIVE_QUEUE'

export interface ArchiveJobMessage {
  jobId: string
  orgId: string
  userId: string
  request: CreateBackgroundJobRequest
}

interface QueueProducer {
  send(message: ArchiveJobMessage): Promise<void>
}

class LocalArchiveQueue {
  private readonly pending: Array<{ platform: Platform; message: ArchiveJobMessage }> = []
  private running = false

  push(platform: Platform, message: ArchiveJobMessage): void {
    this.pending.push({ platform, message })
    if (!this.running) setTimeout(() => void this.drain(), 0)
  }

  private async drain(): Promise<void> {
    if (this.running) return
    this.running = true

    try {
      for (;;) {
        const next = this.pending.shift()
        if (!next) return
        try {
          await runArchiveJobMessage(next.platform, next.message)
        } catch (error) {
          console.error('[archive-jobs] local worker failed:', error)
        }
      }
    } finally {
      this.running = false
      if (this.pending.length > 0) setTimeout(() => void this.drain(), 0)
    }
  }
}

const localArchiveQueue = new LocalArchiveQueue()

export async function dispatchArchiveJob(platform: Platform, message: ArchiveJobMessage): Promise<void> {
  const queue = platform.getBinding<QueueProducer>(ARCHIVE_QUEUE_BINDING)
  if (queue) {
    await queue.send(message)
    return
  }

  localArchiveQueue.push(platform, message)
}

export async function runArchiveJobMessage(platform: Platform, message: ArchiveJobMessage): Promise<void> {
  await processArchiveJob(platform.db, {
    orgId: message.orgId,
    userId: message.userId,
    request: message.request,
    jobId: message.jobId,
  })
}
