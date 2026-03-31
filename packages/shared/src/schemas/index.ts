import { z } from 'zod'

export const signInSchema = z.object({
  email: z.string().email(),
  password: z.string().min(6),
})

export const signUpSchema = z.object({
  name: z.string().min(1),
  email: z.string().email(),
  password: z.string().min(6),
})

export const createStorageSchema = z.object({
  title: z.string().min(1),
  mode: z.enum(['private', 'public']),
  bucket: z.string().min(1),
  endpoint: z.string().url(),
  region: z.string().default('auto'),
  accessKey: z.string().min(1),
  secretKey: z.string().min(1),
  filePath: z.string().default('$UID/$RAW_NAME'),
  customHost: z.string().optional(),
})

export const createMatterSchema = z.object({
  name: z.string().min(1),
  type: z.string(),
  size: z.number().optional(),
  parent: z.string().default(''),
  storageId: z.string(),
  dirtype: z.number().default(0),
})
