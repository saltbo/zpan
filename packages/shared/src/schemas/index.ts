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
  capacityBytes: z.number().optional(),
  priority: z.number().default(0),
})

export const updateStorageSchema = z
  .object({
    title: z.string().min(1),
    mode: z.enum(['private', 'public']),
    bucket: z.string().min(1),
    endpoint: z.string().url(),
    region: z.string(),
    accessKey: z.string().min(1),
    secretKey: z.string().min(1),
    filePath: z.string(),
    customHost: z.string(),
    capacityBytes: z.number(),
    priority: z.number(),
  })
  .partial()

export const createMatterSchema = z.object({
  name: z.string().min(1),
  type: z.string(),
  size: z.number().optional(),
  parent: z.string().default(''),
  storageId: z.string(),
  dirtype: z.number().default(0),
})

export const createFolderSchema = z.object({
  name: z.string().min(1),
  parent: z.string().default(''),
  dirtype: z.literal(1),
})

export const createFileSchema = z.object({
  name: z.string().min(1),
  type: z.string().min(1),
  size: z.number().int().min(0),
  parent: z.string().default(''),
})

export const updateObjectSchema = z
  .object({
    name: z.string().min(1),
    parent: z.string(),
  })
  .partial()

export const copyObjectSchema = z.object({
  parent: z.string().default(''),
})

export const updateStatusSchema = z.object({
  status: z.enum(['active', 'trashed']),
})
