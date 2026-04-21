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
