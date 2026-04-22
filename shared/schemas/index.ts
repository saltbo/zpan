import { z } from 'zod'

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
  size: z.number().optional(),
  parent: z.string().default(''),
  dirtype: z.number().default(0),
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

export const confirmMatterSchema = z.object({
  action: z.literal('confirm'),
  onConflict: conflictStrategySchema.optional(),
})

export const trashMatterSchema = z.object({
  action: z.literal('trash'),
})

export const restoreMatterSchema = z.object({
  action: z.literal('restore'),
  onConflict: conflictStrategySchema.optional(),
})

export const patchMatterSchema = z.discriminatedUnion('action', [
  z.object({
    action: z.literal('update'),
    name: z.string().min(1).optional(),
    parent: z.string().optional(),
    onConflict: conflictStrategySchema.optional(),
  }),
  z.object({
    action: z.literal('confirm'),
    onConflict: conflictStrategySchema.optional(),
  }),
  z.object({
    action: z.literal('trash'),
  }),
  z.object({
    action: z.literal('restore'),
    onConflict: conflictStrategySchema.optional(),
  }),
])

export type PatchMatterInput = z.infer<typeof patchMatterSchema>

export const copyMatterSchema = z.object({
  copyFrom: z.string().min(1),
  parent: z.string().default(''),
  onConflict: conflictStrategySchema.optional(),
})

export const batchPatchSchema = z.discriminatedUnion('action', [
  z.object({
    action: z.literal('move'),
    ids: z.array(z.string().min(1)).min(1),
    parent: z.string().default(''),
    onConflict: conflictStrategySchema.optional(),
  }),
  z.object({
    action: z.literal('trash'),
    ids: z.array(z.string().min(1)).min(1),
  }),
])

export const batchDeleteSchema = z.object({
  ids: z.array(z.string().min(1)).min(1),
})

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

// ─── Avatar Upload ────────────────────────────────────────────────────────────

export const AVATAR_MIMES = ['image/png', 'image/jpeg', 'image/webp'] as const
export type AvatarMime = (typeof AVATAR_MIMES)[number]
export const MAX_AVATAR_SIZE = 2 * 1024 * 1024 // 2 MiB

export const requestAvatarUploadSchema = z.object({
  mime: z.enum(AVATAR_MIMES),
  size: z.number().int().positive().max(MAX_AVATAR_SIZE),
})

export type RequestAvatarUploadInput = z.infer<typeof requestAvatarUploadSchema>

export const commitAvatarSchema = z.object({
  mime: z.enum(AVATAR_MIMES),
})
