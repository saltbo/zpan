import type { downloaders, downloadTasks } from '../../db/schema'

export class DownloadError extends Error {
  constructor(
    readonly code: 'not_found' | 'forbidden' | 'no_downloader' | 'invalid_state' | 'unsupported_source',
    message: string = code,
  ) {
    super(message)
    this.name = 'DownloadError'
  }
}

export type DownloaderRow = typeof downloaders.$inferSelect
export type DownloadTaskRow = typeof downloadTasks.$inferSelect
