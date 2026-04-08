import { z } from 'zod'

export type { CreateStorageInput, UpdateStorageInput } from './storage'
export { createStorageSchema, updateStorageSchema } from './storage'

export const signInSchema = z.object({
  email: z.string().email(),
  password: z.string().min(6),
})

export const signUpSchema = z.object({
  name: z.string().min(1),
  email: z.string().email(),
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
})

export type UpdateMatterInput = z.infer<typeof updateMatterSchema>

export const copyMatterSchema = z.object({
  parent: z.string().default(''),
})
