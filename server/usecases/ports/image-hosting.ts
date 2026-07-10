import type { AllowedImageMime } from '@shared/schemas'
import type { ImageHosting } from '@shared/types'

// Server-side record: the shared DTO, but timestamps stay as Date until the http
// layer serializes them. Drizzle row types never cross this boundary.
export type ImageHostingRecord = Omit<ImageHosting, 'lastAccessedAt' | 'createdAt'> & {
  lastAccessedAt: Date | null
  createdAt: Date
}

export interface CreateImageHostingInput {
  orgId: string
  path: string
  mime: AllowedImageMime
  size: number
  storageId: string
  status: 'draft' | 'active'
}

export interface ListImageHostingsOptions {
  pathPrefix?: string
  cursor?: ImageHostingCursor
  limit: number
}

export interface ImageHostingCursor {
  createdAt: Date
  id: string
}

export interface ImageHostingRepoPage {
  items: ImageHostingRecord[]
  nextCursor: ImageHostingCursor | null
}

export interface ImageResolution {
  image: ImageHostingRecord
  refererAllowlist: string[]
}

export interface ImageHostingRepo {
  // Redirect resolution. Both return the active image plus its org's referer
  // allowlist (parsed): the /r/:token ih_ path and the custom-domain middleware.
  resolveActiveByToken(token: string): Promise<ImageResolution | null>
  resolveActiveByOrgPath(orgId: string, path: string): Promise<ImageResolution | null>
  resolveCustomDomain(host: string): Promise<string | null>
  incrementAccessCount(id: string): Promise<void>

  // CRUD. `create` resolves a unique path on collision before inserting.
  create(input: CreateImageHostingInput): Promise<ImageHostingRecord>
  get(id: string, orgId: string): Promise<ImageHostingRecord | null>
  list(orgId: string, opts: ListImageHostingsOptions): Promise<ImageHostingRepoPage>
  setActive(id: string, orgId: string): Promise<boolean>
  delete(id: string, orgId: string): Promise<void>
}
