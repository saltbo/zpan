import { z } from '@hono/zod-openapi'

// Every error response follows the Google API error model (AIP-193,
// https://google.aip.dev/193): a `google.rpc.Status` wrapped in `error`. One model
// for the whole API so an SDK can model "an error" once instead of a grab-bag of
// per-route top-level fields.
//
//   { "error": {
//       "code": 413,                          // HTTP status
//       "message": "File exceeds the limit.",  // developer-facing, English
//       "status": "FAILED_PRECONDITION",       // canonical google.rpc.Code name
//       "details": [{
//         "@type": "type.googleapis.com/google.rpc.ErrorInfo",
//         "reason": "PAYLOAD_TOO_LARGE",        // the machine-readable switch key
//         "domain": "zpan.dev",
//         "metadata": { "maxBytes": "5242880" } // dynamic context, string→string
//       }] } }
//
// Clients switch on `details[].reason` (stable, UPPER_SNAKE); `status` gives a
// transport-independent error class; loose context that used to leak as extra
// top-level fields now lives in `metadata`.

export const ERROR_DOMAIN = 'zpan.dev'

export const ERROR_INFO_TYPE = 'type.googleapis.com/google.rpc.ErrorInfo'

// The canonical google.rpc.Code enum names we surface in `error.status`.
export const canonicalStatuses = [
  'INVALID_ARGUMENT',
  'FAILED_PRECONDITION',
  'OUT_OF_RANGE',
  'UNAUTHENTICATED',
  'PERMISSION_DENIED',
  'NOT_FOUND',
  'ALREADY_EXISTS',
  'ABORTED',
  'RESOURCE_EXHAUSTED',
  'CANCELLED',
  'DEADLINE_EXCEEDED',
  'UNIMPLEMENTED',
  'UNAVAILABLE',
  'DATA_LOSS',
  'INTERNAL',
  'UNKNOWN',
] as const

export type CanonicalStatus = (typeof canonicalStatuses)[number]

// Default HTTP status → canonical status. A specific site may override the
// canonical status (e.g. a 409 name conflict is ALREADY_EXISTS, a 422 quota
// breach is RESOURCE_EXHAUSTED) while keeping its HTTP code.
const HTTP_TO_CANONICAL: Record<number, CanonicalStatus> = {
  400: 'INVALID_ARGUMENT',
  401: 'UNAUTHENTICATED',
  402: 'FAILED_PRECONDITION',
  403: 'PERMISSION_DENIED',
  404: 'NOT_FOUND',
  405: 'FAILED_PRECONDITION',
  409: 'ABORTED',
  410: 'NOT_FOUND',
  413: 'FAILED_PRECONDITION',
  415: 'INVALID_ARGUMENT',
  422: 'INVALID_ARGUMENT',
  429: 'RESOURCE_EXHAUSTED',
  500: 'INTERNAL',
  501: 'UNIMPLEMENTED',
  502: 'UNAVAILABLE',
  503: 'UNAVAILABLE',
  504: 'DEADLINE_EXCEEDED',
}

export function canonicalStatusForHttp(httpStatus: number): CanonicalStatus {
  return HTTP_TO_CANONICAL[httpStatus] ?? (httpStatus >= 500 ? 'INTERNAL' : 'UNKNOWN')
}

// The machine-readable `reason` values shared across resources. One-off,
// resource-local reasons stay as string literals at their call site; these are the
// ones referenced in more than one place or worth switching on from an SDK.
export const ErrorReason = {
  NAME_CONFLICT: 'NAME_CONFLICT',
  QUOTA_EXCEEDED: 'QUOTA_EXCEEDED',
  INSUFFICIENT_CREDITS: 'INSUFFICIENT_CREDITS',
  FEATURE_NOT_AVAILABLE: 'FEATURE_NOT_AVAILABLE',
  PAYLOAD_TOO_LARGE: 'PAYLOAD_TOO_LARGE',
  UNSUPPORTED_MEDIA_TYPE: 'UNSUPPORTED_MEDIA_TYPE',
  NO_STORAGE_CONFIGURED: 'NO_STORAGE_CONFIGURED',
} as const

export const errorInfoSchema = z
  .object({
    '@type': z.literal(ERROR_INFO_TYPE),
    // Stable, UPPER_SNAKE_CASE, ≤63 chars (AIP-193 / google.rpc.ErrorInfo).
    reason: z.string(),
    domain: z.string(),
    // Dynamic context. AIP-193 requires string values.
    metadata: z.record(z.string(), z.string()).optional(),
  })
  .openapi('ErrorInfo')

// The canonical error body for every failing endpoint. Named once so the OpenAPI
// document — and every generated SDK — shares a single `Error` model.
export const errorResponseSchema = z
  .object({
    error: z.object({
      code: z.number().int(),
      message: z.string(),
      status: z.string(),
      details: z.array(errorInfoSchema).optional(),
    }),
  })
  .openapi('Error')

export type ErrorResponse = z.infer<typeof errorResponseSchema>
export type ErrorInfo = z.infer<typeof errorInfoSchema>
