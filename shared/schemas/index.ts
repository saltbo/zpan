import { z } from 'zod'

export type {
  AnnouncementInput,
  AnnouncementStatus,
  ListAdminAnnouncementsQuery,
  ListAnnouncementsQuery,
} from './announcement'
export {
  announcementInputSchema,
  announcementStatusSchema,
  listAdminAnnouncementsQuerySchema,
  listAnnouncementsQuerySchema,
} from './announcement'
export type { ListAdminAuditQuery } from './audit'
export { listAdminAuditQuerySchema } from './audit'
export type {
  ArchiveCompressJobRequest,
  ArchiveExtractJobRequest,
  BackgroundJobStatusInput,
  BackgroundJobTypeInput,
  CreateBackgroundJobRequest,
  ListBackgroundJobsQuery,
} from './background-jobs'
export {
  archiveCompressJobRequestSchema,
  archiveExtractJobRequestSchema,
  backgroundJobStatusSchema,
  backgroundJobTypeSchema,
  createBackgroundJobRequestSchema,
  listBackgroundJobsQuerySchema,
} from './background-jobs'
export type {
  CheckoutInput,
  CloudCreditBalanceResponse,
  CloudCreditBucket,
  CloudCreditBucketsResponse,
  CloudCreditLedgerEntry,
  CloudCreditLedgerResponse,
  CloudOrder,
  CloudOrderFulfillmentPayload,
  CloudOrderItem,
  CloudOrderQuotaChange,
  CloudProductInput,
  CloudProductPatchInput,
  CreateGiftCardInput,
  DisableGiftCardInput,
  DiscountQuote,
  DiscountQuoteInput,
  GiftCardStatus,
  RedeemGiftCardInput,
  RedeemGiftCardResponse,
} from './cloud-store'
export {
  checkoutInputSchema,
  cloudCreditBalanceResponseSchema,
  cloudCreditBucketSchema,
  cloudCreditBucketsResponseSchema,
  cloudCreditLedgerEntrySchema,
  cloudCreditLedgerResponseSchema,
  cloudOrderFulfillmentPayloadSchema,
  cloudOrderItemSchema,
  cloudOrderQuotaChangeSchema,
  cloudOrderSchema,
  cloudOrdersResponseSchema,
  cloudProductInputSchema,
  cloudProductPatchSchema,
  createGiftCardInputSchema,
  disableGiftCardSchema,
  discountQuoteInputSchema,
  discountQuoteSchema,
  giftCardStatusSchema,
  redeemGiftCardInputSchema,
  redeemGiftCardResponseSchema,
} from './cloud-store'
export type {
  CreateDownloaderInput,
  CreateDownloadTaskInput,
  CreateObjectUploadSessionInput,
  DownloaderHeartbeatInput,
  DownloadTaskActionInput,
  DownloadTaskRuntime,
  DownloadTaskSchema,
  ListDownloadTasksQuery,
  PatchObjectUploadSessionInput,
  PresignObjectUploadPartsInput,
  UpdateDownloaderInput,
  UpdateDownloadTaskInput,
} from './downloads'
export {
  createDownloaderResponseSchema,
  createDownloaderSchema,
  createDownloadTaskSchema,
  createObjectUploadSessionSchema,
  deleteDownloaderResponseSchema,
  downloaderEngineSchema,
  downloaderHeartbeatResponseSchema,
  downloaderHeartbeatSchema,
  downloaderListSchema,
  downloaderSchema,
  downloaderStatusSchema,
  downloadSourceTypeSchema,
  downloadTaskActionInputSchema,
  downloadTaskActionSchema,
  downloadTaskAttemptSchema,
  downloadTaskPageSchema,
  downloadTaskRuntimeSchema,
  downloadTaskSchema,
  downloadTaskStatusSchema,
  downloadTaskStatusUpdateSchema,
  listDownloadTasksQuerySchema,
  objectUploadStatusSchema,
  patchObjectUploadSessionSchema,
  presignObjectUploadPartsSchema,
  updateDownloaderSchema,
  updateDownloadTaskSchema,
} from './downloads'
export { errorResponseSchema, featureGateErrorSchema } from './errors'
export type { ListNotificationsQuery } from './notification'
export { listNotificationsQuerySchema } from './notification'
export type { CreateShareInput, CreateShareRequest, ShareKind } from './share'
export {
  createShareRequestSchema,
  createShareSchema,
  listSharesQuerySchema,
  shareKindSchema,
  shareRecipientSchema,
} from './share'
export type { CreateStorageInput, UpdateStorageInput } from './storage'
export { createStorageSchema, updateStorageSchema } from './storage'

export const signInSchema = z.object({
  email: z.string().email(),
  password: z.string().min(6),
})

export const signUpSchema = z.object({
  email: z.string().email(),
  username: z.string().min(3).max(30),
  password: z.string().min(6),
})

export const conflictStrategySchema = z.enum(['fail', 'rename', 'replace'])
export type ConflictStrategy = z.infer<typeof conflictStrategySchema>

export const createMatterSchema = z.object({
  name: z.string().min(1),
  type: z.string().min(1),
  size: z.number().int().min(0).optional(),
  parent: z.string().default(''),
  dirtype: z.number().int().default(0),
  onConflict: conflictStrategySchema.optional(),
})

export type CreateMatterInput = z.infer<typeof createMatterSchema>

export const updateMatterSchema = z.object({
  action: z.literal('update').optional().default('update'),
  name: z.string().min(1).optional(),
  parent: z.string().optional(),
  onConflict: conflictStrategySchema.optional(),
})

export type UpdateMatterInput = z.infer<typeof updateMatterSchema>

export const objectDraftSchema = z.object({
  id: z.string(),
  name: z.string(),
  uploadUrl: z.string().optional(),
  contentDisposition: z.string().optional(),
})

export const objectUploadSessionSchema = z.object({
  id: z.string(),
  objectId: z.string(),
  uploadId: z.string(),
  partSize: z.number().int(),
  status: z.enum(['active', 'completed', 'aborted']),
  expiresAt: z.string(),
  createdAt: z.string(),
  updatedAt: z.string(),
})

export const presignedObjectUploadPartSchema = z.object({
  partNumber: z.number().int(),
  url: z.string(),
})

export const presignObjectUploadPartsResponseSchema = z.object({
  uploadId: z.string(),
  partSize: z.number().int(),
  parts: z.array(presignedObjectUploadPartSchema),
})

// PATCH /api/objects/:id — partial update of a live object (rename / move).
export const patchMatterSchema = z.object({
  name: z.string().min(1).optional(),
  parent: z.string().optional(),
  onConflict: conflictStrategySchema.optional(),
})

export type PatchMatterInput = z.infer<typeof patchMatterSchema>

// PUT /api/objects/:id/status — lifecycle transitions.
//   { status: 'active' }  → confirm a draft, or restore from trash (server picks by current state)
//   { status: 'trashed' } → move a live object to trash
// Discarding a draft and purging a trashed object are both DELETE /api/objects/:id.
export const objectStatusSchema = z.object({
  status: z.enum(['active', 'trashed']),
  onConflict: conflictStrategySchema.optional(),
})

export type ObjectStatusInput = z.infer<typeof objectStatusSchema>

export const copyMatterSchema = z.object({
  copyFrom: z.string().min(1),
  parent: z.string().default(''),
  onConflict: conflictStrategySchema.optional(),
})

// POST /api/objects/:id/copies — the source object id comes from the path.
export const copyObjectBodySchema = z.object({
  parent: z.string().default(''),
  onConflict: conflictStrategySchema.optional(),
})

export type CopyObjectBodyInput = z.infer<typeof copyObjectBodySchema>

export const transferMatterSchema = z.object({
  targetOrgId: z.string().min(1),
  targetParent: z.string().default(''),
  mode: z.enum(['copy', 'move']),
})

export type TransferMatterInput = z.infer<typeof transferMatterSchema>

// ─── Image Hosting Config ─────────────────────────────────────────────────────

// Valid hostname regex: lowercase labels separated by dots, max 253 chars total,
// each label max 63 chars, no leading/trailing dots, no port.
const hostnameRegex = /^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z0-9][a-z0-9-]{0,61}[a-z0-9]$/

// Valid referer origin: protocol + host + optional port, no path/query.
const refererOriginRegex = /^https?:\/\/[a-zA-Z0-9.-]+(:\d+)?$/

export const putIhostConfigSchema = z.object({
  enabled: z.literal(true),
  customDomain: z.string().max(253).regex(hostnameRegex, 'Invalid hostname format').nullable().optional(),
  refererAllowlist: z
    .array(z.string().regex(refererOriginRegex, 'Each entry must be a valid origin (e.g. https://example.com)'))
    .max(50)
    .nullable()
    .optional(),
})

export type PutIhostConfigInput = z.infer<typeof putIhostConfigSchema>

// ─── Image Hosting ────────────────────────────────────────────────────────────

export const MAX_IMAGE_SIZE = 20 * 1024 * 1024
export const ALLOWED_IMAGE_MIMES = ['image/png', 'image/jpeg', 'image/gif', 'image/webp'] as const
export type AllowedImageMime = (typeof ALLOWED_IMAGE_MIMES)[number]

export const createIhostImageSchema = z.object({
  path: z.string().min(1).max(256),
  mime: z.enum(ALLOWED_IMAGE_MIMES),
  size: z.number().int().positive(),
})

export type CreateIhostImageInput = z.infer<typeof createIhostImageSchema>

export const patchIhostImageSchema = z.discriminatedUnion('action', [z.object({ action: z.literal('confirm') })])

export type PatchIhostImageInput = z.infer<typeof patchIhostImageSchema>

export const listIhostImagesSchema = z.object({
  pathPrefix: z.string().optional(),
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
})

// ─── Public image upload (avatar, org logo) ─────────────────────────────────
// Constants only — server validates in services/image-upload.ts; client uses
// these for pre-submit validation + UI hints.

export const PUBLIC_IMAGE_MIMES = ['image/png', 'image/jpeg', 'image/webp'] as const
export type PublicImageMime = (typeof PUBLIC_IMAGE_MIMES)[number]
export const MAX_PUBLIC_IMAGE_SIZE = 2 * 1024 * 1024 // 2 MiB
