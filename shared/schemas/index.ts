import { z } from 'zod'

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

export const createMatterSchema = z.object({
  name: z.string().min(1),
  type: z.string().min(1),
  size: z.number().optional(),
  parent: z.string().default(''),
  dirtype: z.number().default(0),
})

export type CreateMatterInput = z.infer<typeof createMatterSchema>

export const updateMatterSchema = z.object({
  name: z.string().min(1).optional(),
  parent: z.string().optional(),
  isPublic: z.boolean().optional(),
})

export type UpdateMatterInput = z.infer<typeof updateMatterSchema>

export const batchVisibilitySchema = z.object({
  ids: z.array(z.string().min(1)).min(1),
  isPublic: z.boolean(),
})

export type BatchVisibilityInput = z.infer<typeof batchVisibilitySchema>

export const copyMatterSchema = z.object({
  parent: z.string().default(''),
})

export const batchMoveSchema = z.object({
  ids: z.array(z.string().min(1)).min(1),
  parent: z.string().default(''),
})

export const batchIdsSchema = z.object({
  ids: z.array(z.string().min(1)).min(1),
})
