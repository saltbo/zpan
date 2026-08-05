import { z } from 'zod'
import { opaqueIdSchema } from './id'

export {
  adminAnalyticsGrowthSchema,
  adminAnalyticsOperationsSchema,
  adminAnalyticsOverviewSchema,
  adminAnalyticsSharingSchema,
  adminAnalyticsStorageSchema,
  adminAnalyticsTrafficSchema,
  adminOverviewSchema,
} from './admin-analytics'
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
  CapacityPurchaseResult,
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
  X402PaymentRequired,
} from './cloud-store'
export {
  capacityPurchaseDeliveredResultSchema,
  capacityPurchasePendingResultSchema,
  capacityPurchaseResultSchema,
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
  x402PaymentRequiredSchema,
} from './cloud-store'
export type {
  CompleteObjectUploadInput,
  CreateDownloaderInput,
  CreateDownloadTaskInput,
  DownloaderHeartbeatInput,
  DownloaderHeartbeatResult,
  DownloadTaskActionInput,
  DownloadTaskEvent,
  DownloadTaskListItem,
  DownloadTaskRuntime,
  DownloadTaskSchema,
  ListDownloadTasksQuery,
  PresignObjectUploadPartsInput,
  UpdateDownloaderCreditBillingInput,
  UpdateDownloaderInput,
  UpdateDownloadTaskInput,
} from './downloads'
export {
  completeObjectUploadSchema,
  createDownloaderResponseSchema,
  createDownloaderSchema,
  createDownloadTaskSchema,
  downloaderEngineSchema,
  downloaderHeartbeatResponseSchema,
  downloaderHeartbeatResultSchema,
  downloaderHeartbeatSchema,
  downloaderListSchema,
  downloaderSchema,
  downloaderStatusSchema,
  downloadSourceTypeSchema,
  downloadTaskActionInputSchema,
  downloadTaskActionSchema,
  downloadTaskAttemptSchema,
  downloadTaskEventSchema,
  downloadTaskListItemRuntimeSchema,
  downloadTaskListItemSchema,
  downloadTaskListPageSchema,
  downloadTaskPageSchema,
  downloadTaskRuntimeSchema,
  downloadTaskSchema,
  downloadTaskStatusSchema,
  downloadTaskStatusUpdateSchema,
  downloadTaskTimelineSchema,
  listDownloadTasksQuerySchema,
  presignObjectUploadPartsSchema,
  updateDownloaderCreditBillingSchema,
  updateDownloaderSchema,
  updateDownloadTaskSchema,
} from './downloads'
export type { CanonicalStatus, ErrorInfo, ErrorResponse } from './errors'
export {
  canonicalStatuses,
  canonicalStatusForHttp,
  ERROR_DOMAIN,
  ERROR_INFO_TYPE,
  ErrorReason,
  errorInfoSchema,
  errorResponseSchema,
} from './errors'
export { base62IdSchema, imageTokenSchema, opaqueIdSchema, opaqueTokenSchema, shareTokenSchema } from './id'
export type { ListNotificationsQuery } from './notification'
export { listNotificationsQuerySchema } from './notification'
export type { WorkspaceAuthorizationDetail } from './oauth-authorization'
export { parseWorkspaceAuthorizationDetails, workspaceAuthorizationDetailSchema } from './oauth-authorization'
export type {
  OAuthConsentContext,
  OAuthConsentContextRequest,
  OAuthConsentResult,
  OAuthConsentSubmit,
  OAuthGrant,
  OAuthGrantList,
  OAuthGrantStatus,
} from './oauth-grants'
export {
  oauthConsentContextRequestSchema,
  oauthConsentContextSchema,
  oauthConsentResultSchema,
  oauthConsentSubmitSchema,
  oauthGrantDTO,
  oauthGrantListSchema,
  oauthGrantSchema,
  oauthGrantStatusSchema,
} from './oauth-grants'
export type { OAuthGrantScope, OAuthResourceScope } from './oauth-resource'
export { oauthGrantScopeSchema, oauthResourceScopeLabels, oauthResourceScopeSchema } from './oauth-resource'
export type { CursorPage, CursorPageQuery, Page, PageQuery } from './pagination'
export { cursorPageQuerySchema, cursorPageSchema, pageQuerySchema, pageSchema } from './pagination'
export type { PublicProfile, PublicProfileShare, PublicUser } from './profile'
export { publicProfileSchema, publicProfileShareSchema, publicUserSchema } from './profile'
export type {
  CreateShareInput,
  CreateShareRequest,
  ShareKind,
  ShareObjectItem,
  ShareObjectsResponse,
  ShareReadmeResponse,
} from './share'
export {
  createShareRequestSchema,
  createShareSchema,
  listSharesQuerySchema,
  shareKindSchema,
  shareObjectItemSchema,
  shareObjectsResponseSchema,
  shareReadmeResponseSchema,
  shareRecipientSchema,
  shareRecipientViewSchema,
} from './share'
export type {
  CreateTestEmailInput,
  EmailSettings,
  ImageDomainDnsRecord,
  ImageDomainProviderResponse,
  ImageDomainSettings,
  SiteBranding,
  SiteCaptchaSettings,
  SiteConfig,
  SiteIdentitySettings,
  SiteQuotaSettings,
  SiteRegistrationSettings,
  SiteSettings,
  SiteWebDavSettings,
  UpdateEmailSettingsInput,
  UpdateImageDomainSettingsInput,
  UpdateSiteCaptchaInput,
  UpdateSiteIdentityInput,
  UpdateSiteQuotasInput,
  UpdateSiteRegistrationInput,
  UpdateSiteWebDavInput,
} from './site-config'
export {
  captchaProviderSchema,
  cloudflareEmailSettingsSchema,
  cloudflareSaasImageDomainSettingsSchema,
  createTestEmailSchema,
  emailSettingsSchema,
  emptyEmailSettingsSchema,
  emptyImageDomainSettingsSchema,
  httpEmailSettingsSchema,
  imageDomainDnsRecordSchema,
  imageDomainProviderResponseSchema,
  imageDomainProviderStatusSchema,
  imageDomainSettingsSchema,
  manualImageDomainSettingsSchema,
  publicAuthProviderSchema,
  publicCaptchaSchema,
  signupModeSchema,
  siteBrandingSchema,
  siteCaptchaSettingsSchema,
  siteConfigSchema,
  siteIdentitySettingsSchema,
  siteQuotaSettingsSchema,
  siteRegistrationSettingsSchema,
  siteSettingsSchema,
  siteWebDavSettingsSchema,
  smtpEmailSettingsSchema,
  updateEmailSettingsSchema,
  updateImageDomainSettingsSchema,
  updateSiteCaptchaSchema,
  updateSiteIdentitySchema,
  updateSiteQuotasSchema,
  updateSiteRegistrationSchema,
  updateSiteWebDavSchema,
  webDavVerificationStatusSchema,
} from './site-config'
export type {
  CreateStorageInput,
  PatchStorageInput,
  ReplaceStorageInput,
  UpdateStorageEgressBillingInput,
} from './storage'
export {
  createStorageSchema,
  patchStorageSchema,
  replaceStorageSchema,
  updateStorageEgressBillingSchema,
} from './storage'

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

const matterParentPathSchema = z
  .string()
  .describe('Slash-delimited parent folder path relative to the workspace root; use an empty string for the root.')

export const createMatterSchema = z.object({
  name: z.string().min(1),
  type: z.string().min(1).optional(),
  size: z.number().int().min(0).optional(),
  parent: matterParentPathSchema.default(''),
  dirtype: z.number().int().default(0),
  onConflict: conflictStrategySchema.optional(),
  storageId: opaqueIdSchema
    .describe(
      'Only site administrators may set this field; omit it to let ZPan automatically select an available storage.',
    )
    .optional(),
})

export type CreateMatterInput = z.infer<typeof createMatterSchema>

export const updateMatterSchema = z.object({
  action: z.literal('update').optional().default('update'),
  name: z.string().min(1).optional(),
  parent: matterParentPathSchema.optional(),
  onConflict: conflictStrategySchema.optional(),
})

export type UpdateMatterInput = z.infer<typeof updateMatterSchema>

export const presignedObjectUploadPartSchema = z.object({
  partNumber: z.number().int().min(1).max(10_000),
  url: z.string(),
  expiresAt: z.string(),
  headers: z.record(z.string(), z.string()),
  offset: z.number().int().min(0),
  length: z.number().int().min(0),
})

export const objectUploadWorkflowSchema = z.object({
  version: z.literal('1'),
  upload: z.object({
    method: z.literal('PUT'),
    urlField: z.literal('parts[].url'),
    headersField: z.literal('parts[].headers'),
    fileOffsetField: z.literal('parts[].offset'),
    contentLengthField: z.literal('parts[].length'),
    etagHeader: z.literal('ETag'),
  }),
  complete: z.object({
    operationId: z.literal('completeObjectUpload'),
    method: z.literal('POST'),
    path: z.string(),
    partsBodyField: z.literal('parts'),
  }),
  rePresign: z.object({
    operationId: z.literal('presignObjectUploadParts'),
    method: z.literal('POST'),
    path: z.string(),
    partNumbersBodyField: z.literal('partNumbers'),
  }),
  abort: z.object({
    operationId: z.literal('abortObjectUpload'),
    method: z.literal('DELETE'),
    path: z.string(),
  }),
})

// The upload instructions returned by POST /objects for a file draft. File bytes
// still go directly to presigned S3 URLs; the server exposes stable part
// identities so automation never infers part numbers from URL positions.
export const objectUploadInstructionsSchema = z.object({
  sessionId: opaqueIdSchema,
  uploadId: z.string().nullable(),
  mode: z.enum(['single', 'multipart']),
  partSize: z.number().int(),
  partCount: z.number().int().min(1).max(10_000),
  expiresAt: z.string(),
  presignedExpiresAt: z.string(),
  requiredHeaders: z.record(z.string(), z.string()),
  urls: z.array(z.string()),
  parts: z.array(presignedObjectUploadPartSchema),
  workflow: objectUploadWorkflowSchema,
})

export const presignObjectUploadPartsResponseSchema = z.object({
  uploadId: z.string().nullable(),
  mode: z.enum(['single', 'multipart']),
  partSize: z.number().int(),
  partCount: z.number().int().min(1).max(10_000),
  presignedExpiresAt: z.string(),
  requiredHeaders: z.record(z.string(), z.string()),
  parts: z.array(presignedObjectUploadPartSchema),
})

// PATCH /api/objects/:id — partial update of a live object (rename / move).
export const patchMatterSchema = z.object({
  name: z.string().min(1).optional(),
  parent: z.string().optional(),
  onConflict: conflictStrategySchema.optional(),
})

export type PatchMatterInput = z.infer<typeof patchMatterSchema>

// POST /api/trash/objects/:id/restorations — move a trashed object back to live.
// onConflict resolves a same-named item created in the original parent while this
// one sat in trash (default 'fail').
export const restoreObjectSchema = z.object({
  onConflict: conflictStrategySchema.optional(),
})

export type RestoreObjectInput = z.infer<typeof restoreObjectSchema>

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
  targetOrgId: opaqueIdSchema,
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
  pageToken: z.string().min(1).optional(),
  pageSize: z.coerce.number().int().min(1).max(100).default(50),
})

// ─── Public image upload (avatar, org logo) ─────────────────────────────────
// Constants only — avatars/logos are hosted on the ZPan Cloud avatar service; the
// client uses these for pre-submit validation + UI hints. Kept in sync with the
// SDK's AVATAR_CONTENT_TYPES + MAX_AVATAR_BYTES so the client rejects what Cloud
// would reject (the server is the source of truth via zpan-cloud-sdk).

export const PUBLIC_IMAGE_MIMES = ['image/png', 'image/jpeg', 'image/webp', 'image/gif'] as const
export type PublicImageMime = (typeof PUBLIC_IMAGE_MIMES)[number]
export const MAX_PUBLIC_IMAGE_SIZE = 1 * 1024 * 1024 // 1 MiB (SDK MAX_AVATAR_BYTES)
