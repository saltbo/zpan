import { z } from 'zod'

export const createFolderSchema = z.object({
  name: z.string().min(1),
  parent: z.string().default(''),
  dirtype: z.literal(1),
})

export const createFileSchema = z.object({
  name: z.string().min(1),
  size: z.number().int().positive(),
  type: z.string().min(1),
  parent: z.string().default(''),
})

export const createObjectSchema = z.union([createFolderSchema, createFileSchema])

export const updateObjectSchema = z.object({
  name: z.string().min(1).optional(),
  parent: z.string().optional(),
})

export const copyObjectSchema = z.object({
  parent: z.string().optional(),
})
