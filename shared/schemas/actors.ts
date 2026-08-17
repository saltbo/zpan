import { z } from '@hono/zod-openapi'

export const actorTypeSchema = z.enum([
  'user',
  'api_key',
  'oauth',
  'agent',
  'anonymous',
  'system',
  'device',
  'task-upload',
])

export const actorIdentitySchema = z
  .object({
    type: actorTypeSchema,
    ref: z.string().nullable(),
    issuer: z.string().nullable(),
  })
  .openapi('ActorIdentity')

export const actorProfileSchema = z
  .object({
    type: actorTypeSchema,
    ref: z.string().nullable(),
    issuer: z.string().nullable(),
    name: z.string(),
    image: z.string().nullable(),
    profileUrl: z.string().url().nullable().optional(),
  })
  .openapi('ActorProfile')

export const actorAttributionSchema = z
  .object({
    type: actorTypeSchema,
    ref: z.string().nullable(),
    issuer: z.string().nullable(),
    name: z.string(),
    image: z.string().nullable(),
    profileUrl: z.string().url().nullable().optional(),
    resolved: z.boolean(),
  })
  .openapi('ActorAttribution')

export type ActorType = z.infer<typeof actorTypeSchema>
export type ActorIdentity = z.infer<typeof actorIdentitySchema>
export type ActorProfile = z.infer<typeof actorProfileSchema>
export type ActorAttribution = z.infer<typeof actorAttributionSchema>
