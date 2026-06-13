import type { Platform } from '../../platform/interface'
import { processArchiveJob } from '../../usecases/archive-processing'
import type { ArchiveJobMessage, ArchiveJobsGateway } from '../../usecases/ports'
import { createArchiveTargetFolderRepo } from '../repos/archive-target-folder'
import { createBackgroundJobRepo } from '../repos/background-job'
import { createMatterRepo } from '../repos/matter'
import { createNotificationRepo } from '../repos/notification'
import { createQuotaRepo } from '../repos/quota'
import { createStorageRepo } from '../repos/storage'
import { createStorageUsageRepo } from '../repos/storage-usage'
import { createZipPlanRepo } from '../repos/zip'
import { S3Service } from './s3'
import { createZipGateway } from './zip'

export const ARCHIVE_QUEUE_BINDING = 'ARCHIVE_QUEUE'

interface QueueProducer {
  send(message: ArchiveJobMessage): Promise<void>
}

// When no queue binding is present (Node/dev), jobs run in-process. The queue
// drains on the next tick so dispatch resolves before the work starts, matching
// the fire-and-forget semantics of a Cloudflare Queue producer.
class LocalArchiveQueue {
  private readonly pending: ArchiveJobMessage[] = []
  private running = false

  constructor(private readonly run: (message: ArchiveJobMessage) => Promise<void>) {}

  push(message: ArchiveJobMessage): void {
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
          console.error('[archive-jobs] local worker failed:', error)
        }
      }
    } finally {
      this.running = false
      if (this.pending.length > 0) setTimeout(() => void this.drain(), 0)
    }
  }
}

export function createArchiveJobsGateway(platform: Platform): ArchiveJobsGateway {
  const { db } = platform
  // The archive usecase composes existing ports; assemble exactly the subset it
  // needs from the platform here (the queue consumer entrypoint), so composition
  // can keep constructing this gateway with only the platform.
  const deps = {
    s3: new S3Service(),
    storages: createStorageRepo(db),
    quota: createQuotaRepo(db),
    storageUsage: createStorageUsageRepo(db),
    backgroundJobs: createBackgroundJobRepo(db),
    notifications: createNotificationRepo(db),
    zip: createZipGateway(),
    zipPlan: createZipPlanRepo(db),
    archiveTargetFolders: createArchiveTargetFolderRepo(db),
    matter: createMatterRepo(db),
  }

  async function runMessage(message: ArchiveJobMessage): Promise<void> {
    await processArchiveJob(deps, {
      orgId: message.orgId,
      userId: message.userId,
      request: message.request,
      jobId: message.jobId,
    })
  }

  const localQueue = new LocalArchiveQueue(runMessage)

  return {
    async dispatch(message) {
      const queue = platform.getBinding<QueueProducer>(ARCHIVE_QUEUE_BINDING)
      if (queue) {
        await queue.send(message)
        return
      }
      localQueue.push(message)
    },
    runMessage,
  }
}
