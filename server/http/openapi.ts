import type { z } from '@hono/zod-openapi'
import { errorResponseSchema } from '@shared/schemas'

// Shared OpenAPI route helpers used by every resource router. Generic over the
// schema so its precise type reaches `createRoute`: that types `c.req.valid(...)`
// on the request side and strictly checks the handler's `c.json(...)` on the
// response side. A widened `z.ZodType` would erase both — and silently disable
// response checking, which is how schemas drift from what handlers actually
// return.

export const jsonContent = <T extends z.ZodType>(schema: T, description: string) => ({
  content: { 'application/json': { schema } },
  description,
})

export const jsonBody = <T extends z.ZodType>(schema: T) => ({
  body: { content: { 'application/json': { schema } }, required: true },
})

// A route response carrying the shared AIP-193 `Error` envelope. Handlers and
// usecases produce errors as `AppError` values that `app.onError` renders via
// `jsonError`; this just documents the response shape in the OpenAPI document.
export const errorResponse = (description: string) => jsonContent(errorResponseSchema, description)
