import type { Platform } from '../../platform/interface'
import type { CreateDownloaderRecordInput } from './downloads'

export interface DownloaderBootstrapCredential {
  userId: string
  clientId: 'zpan-cli'
  scope: 'downloader:register'
  active: boolean
}

export interface DownloaderBootstrapCredentialRepo {
  issue(input: {
    platform: Platform
    token: string
    userId: string
    deviceCode: string
    expiresAt: Date
  }): Promise<void>
  resolve(platform: Platform, token: string, now: Date): Promise<DownloaderBootstrapCredential | null>
  consume(platform: Platform, token: string, now: Date): Promise<DownloaderBootstrapCredential | null>
  registerDownloader(input: {
    platform: Platform
    token: string
    now: Date
    downloader: CreateDownloaderRecordInput
  }): Promise<boolean>
}
