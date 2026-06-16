import { z } from '@hono/zod-openapi'

// The canonical error body every endpoint returns on failure: a human-readable
// `error` plus an optional machine-readable `code` (e.g. `NAME_CONFLICT`) clients
// and SDKs can switch on. Named once so the OpenAPI document — and every generated
// SDK — shares a single `ErrorResponse` model instead of re-inlining it per
// operation.
export const errorResponseSchema = z.object({ error: z.string(), code: z.string().optional() }).openapi('ErrorResponse')

// A feature-gated rejection (HTTP 402): the caller's plan lacks a capability.
// Carries the feature key plus optional limit context the UI uses to prompt an
// upgrade.
export const featureGateErrorSchema = z
  .object({
    error: z.string(),
    feature: z.string(),
    currentCount: z.number().int().optional(),
    limit: z.number().int().optional(),
    upgrade_url: z.string().optional(),
  })
  .openapi('FeatureGateError')
