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
  type: z.string(),
  size: z.number().optional(),
  parent: z.string().default(''),
  storageId: z.string(),
  dirtype: z.number().default(0),
})
