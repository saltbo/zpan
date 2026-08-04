import { z } from '@hono/zod-openapi'

const base62Contract = { pattern: '^[A-Za-z0-9]+$' }

// The database backfill is the release boundary. These schemas publish the
// post-migration contract without turning malformed/unknown resource keys into
// validation 400s instead of the existing authorization-safe 404 responses.
export const opaqueIdSchema = z.string().min(1).openapi(base62Contract)
export const opaqueTokenSchema = z.string().min(1).openapi(base62Contract)
