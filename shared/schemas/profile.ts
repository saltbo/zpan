import { z } from 'zod'

export const publicUserSchema = z.object({
  username: z.string(),
  name: z.string(),
  image: z.string().nullable(),
})

export const publicProfileShareSchema = z.object({
  token: z.string(),
  name: z.string(),
  type: z.string(),
  size: z.number().int().nullable(),
  isFolder: z.boolean(),
})

export const publicProfileSchema = z.object({
  user: publicUserSchema,
  shares: z.array(publicProfileShareSchema),
})

export type PublicUser = z.infer<typeof publicUserSchema>
export type PublicProfileShare = z.infer<typeof publicProfileShareSchema>
export type PublicProfile = z.infer<typeof publicProfileSchema>
