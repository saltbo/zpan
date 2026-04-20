import { z } from 'zod'

export type { ListNotificationsQuery } from './notification'
export { listNotificationsQuerySchema } from './notification'
export type { CreateShareInput, ShareKind } from './share'
export { createShareSchema, listSharesQuerySchema, shareKindSchema, shareRecipientSchema } from './share'
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
  name: z.string().min(1).optional(),
  parent: z.string().optional(),
  onConflict: conflictStrategySchema.optional(),
})

export type UpdateMatterInput = z.infer<typeof updateMatterSchema>

export const copyMatterSchema = z.object({
  parent: z.string().default(''),
  onConflict: conflictStrategySchema.optional(),
})

export const batchMoveSchema = z.object({
  ids: z.array(z.string().min(1)).min(1),
  parent: z.string().default(''),
  onConflict: conflictStrategySchema.optional(),
})

export const batchIdsSchema = z.object({
  ids: z.array(z.string().min(1)).min(1),
})

export const confirmUploadSchema = z.object({
  onConflict: conflictStrategySchema.optional(),
})

export const restoreMatterSchema = z.object({
  onConflict: conflictStrategySchema.optional(),
})
