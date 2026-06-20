import { type CanonicalStatus, ErrorReason } from '@shared/schemas'

// A returned (or thrown) business error carrying everything the HTTP boundary
// needs to render an AIP-193 body — without the usecase layer ever naming an
// HTTP status. Usecases produce these via the factories below (`notFound()`,
// `quotaExceeded()`, …); the status, wire reason and canonical code live in ONE
// place (the factory), so no handler hand-writes `apiError(c, 404, …)` and no
// reason string drifts. The HTTP boundary renders any AppError uniformly via
// `jsonError(c, result.error)`.
export class AppError extends Error {
  constructor(
    readonly httpStatus: number,
    message: string,
    readonly meta: {
      reason?: string
      canonicalStatus?: CanonicalStatus
      metadata?: Record<string, string>
      // Response headers the boundary must set (e.g. `Retry-After` on a 429).
      headers?: Record<string, string>
    } = {},
  ) {
    super(message)
    this.name = 'AppError'
  }
}

type ExtraMeta = { metadata?: Record<string, string> }

// Shared, cross-resource business errors. Each bakes in its HTTP status + AIP-193
// reason once. Pass a resource-specific message (e.g. `notFound('Order not found')`)
// and, where relevant, `metadata`.
export const notFound = (message = 'Not found') => new AppError(404, message)
export const storageNotFound = (message = 'Storage not found') => new AppError(404, message)
export const forbidden = (message = 'Forbidden') => new AppError(403, message)
export const unauthorized = (message = 'Unauthorized') => new AppError(401, message)
export const passwordRequired = (message = 'Password required') => new AppError(401, message)
export const expired = (message = 'Expired') => new AppError(410, message)
export const conflict = (message: string, reason?: string) => new AppError(409, message, { reason })
export const badRequest = (message: string, reason?: string) => new AppError(400, message, { reason })
export const badGateway = (message: string, reason?: string) => new AppError(502, message, { reason })
export const internalError = (message = 'Internal error', reason?: string) => new AppError(500, message, { reason })

export const payloadTooLarge = (message = 'Payload too large') =>
  new AppError(413, message, { reason: ErrorReason.PAYLOAD_TOO_LARGE })

export const rateLimited = (message: string, retryAfterSeconds?: number) =>
  new AppError(429, message, {
    headers: retryAfterSeconds === undefined ? undefined : { 'Retry-After': String(retryAfterSeconds) },
  })

export const unsupportedMediaType = (message = 'Unsupported media type') =>
  new AppError(415, message, { reason: ErrorReason.UNSUPPORTED_MEDIA_TYPE })

export const noStorage = (message = 'No storage configured') =>
  new AppError(503, message, { reason: ErrorReason.NO_STORAGE_CONFIGURED })

export const quotaExceeded = (message = 'Quota exceeded') =>
  new AppError(422, message, { reason: ErrorReason.QUOTA_EXCEEDED, canonicalStatus: 'RESOURCE_EXHAUSTED' })

export const insufficientCredits = (message = 'Insufficient credits', opts: ExtraMeta = {}) =>
  new AppError(402, message, { reason: ErrorReason.INSUFFICIENT_CREDITS, metadata: opts.metadata })

export const featureBlocked = (message = 'Feature not available', opts: ExtraMeta = {}) =>
  new AppError(402, message, { reason: ErrorReason.FEATURE_NOT_AVAILABLE, metadata: opts.metadata })
