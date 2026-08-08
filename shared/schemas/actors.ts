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
export type ActorAttribution = z.infer<typeof actorAttributionSchema>
