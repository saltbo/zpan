import type { DownloadTaskRecord, DownloadTaskRepo } from '../ports'
import { DownloadError } from '../ports'

// A task's upload token acts only while its task is still running on the
// downloader it was minted for.
export async function assertTaskUploadAllowed(
  deps: { downloadTasks: DownloadTaskRepo },
  params: { taskId: string; downloaderId: string },
): Promise<DownloadTaskRecord> {
  const task = await deps.downloadTasks.findRecord(params.taskId)
  if (!task || task.assignedDownloaderId !== params.downloaderId) throw new DownloadError('forbidden')
  if (!['assigned', 'downloading', 'uploading'].includes(task.status)) throw new DownloadError('invalid_state')
  return task
}
