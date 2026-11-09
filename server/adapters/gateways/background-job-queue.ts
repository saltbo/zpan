import type { Platform } from '../../platform/interface'
import type { BackgroundJobMessage, BackgroundJobQueue } from '../../usecases/ports'

// The binding keeps its original name so existing deployments keep their
// provisioned Cloudflare Queue; it now carries every background job type.
export const BACKGROUND_JOB_QUEUE_BINDING = 'ARCHIVE_QUEUE'

interface QueueProducer {
  send(message: BackgroundJobMessage): Promise<void>
  sendBatch(messages: Iterable<{ body: BackgroundJobMessage }>): Promise<void>
}

// When no queue binding is present (Node/dev), jobs run in-process. The queue
// drains on the next tick so dispatch resolves before the work starts, matching
// the fire-and-forget semantics of a Cloudflare Queue producer.
class LocalJobQueue {
  private readonly pending: BackgroundJobMessage[] = []
  private running = false

  constructor(private readonly run: (message: BackgroundJobMessage) => Promise<void>) {}

  push(message: BackgroundJobMessage): void {
    this.pending.push(message)
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
          await this.run(next)
        } catch (error) {
          console.error('[background-jobs] local worker failed:', error)
        }
      }
    } finally {
      this.running = false
      if (this.pending.length > 0) setTimeout(() => void this.drain(), 0)
    }
  }
}

export function createBackgroundJobQueue(
  platform: Platform,
  run: (message: BackgroundJobMessage) => Promise<void>,
): BackgroundJobQueue {
  const localQueue = new LocalJobQueue(run)

  return {
    async dispatch(message) {
      const queue = platform.getBinding<QueueProducer>(BACKGROUND_JOB_QUEUE_BINDING)
      if (queue) {
        await queue.send(message)
        return
      }
      localQueue.push(message)
    },

    async dispatchBatch(messages) {
      const queue = platform.getBinding<QueueProducer>(BACKGROUND_JOB_QUEUE_BINDING)
      if (queue) {
        await queue.sendBatch(messages.map((body) => ({ body })))
        return
      }
      for (const message of messages) localQueue.push(message)
    },
  }
}
