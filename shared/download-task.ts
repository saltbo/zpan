import type { DownloadTask, DownloadTaskListItem } from './schemas/downloads'

export function toDownloadTaskListItem(task: DownloadTask): DownloadTaskListItem {
  const runtime = task.status.runtime
  return {
    id: task.id,
    spec: task.spec,
    status: {
      state: task.status.state,
      progress: task.status.progress,
      runtime: runtime
        ? {
            phase: runtime.phase,
            etaSeconds: runtime.etaSeconds,
            torrent: runtime.torrent,
          }
        : null,
    },
    createdAt: task.createdAt,
  }
}
