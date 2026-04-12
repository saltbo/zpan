import { z } from 'zod'

export const createStorageSchema = z.object({
  title: z.string().min(1),
  mode: z.enum(['private', 'public']),
  bucket: z.string().min(1),
  endpoint: z.string().url(),
  region: z.string().default('auto'),
  accessKey: z.string().min(1),
  secretKey: z.string().min(1),
  customHost: z.string().optional(),
  capacity: z.number().int().min(0).default(0),
})

export const updateStorageSchema = z.object({
  title: z.string().min(1).optional(),
  mode: z.enum(['private', 'public']).optional(),
  bucket: z.string().min(1).optional(),
  endpoint: z.string().url().optional(),
  region: z.string().optional(),
  accessKey: z.string().min(1).optional(),
  secretKey: z.string().min(1).optional(),
  customHost: z.string().optional(),
  capacity: z.number().int().min(0).optional(),
  status: z.enum(['active', 'disabled']).optional(),
})

export type CreateStorageInput = z.infer<typeof createStorageSchema>
export type UpdateStorageInput = z.infer<typeof updateStorageSchema>
