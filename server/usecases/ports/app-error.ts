import { type CanonicalStatus, ErrorReason } from '@shared/schemas'
import { type ErrorLanguage, type ErrorMessage, englishMessage, localizeMessage } from './error-messages'

// A returned (or thrown) business error carrying everything the HTTP boundary
// needs to render an AIP-193 body — without the usecase layer ever naming an
// HTTP status. Usecases produce these via the factories below (`notFound()`,
// `quotaExceeded()`, …); the status, wire reason and canonical code live in ONE
// place (the factory), so no handler hand-writes `apiError(c, 404, …)` and no
// reason string drifts. The HTTP boundary renders any AppError uniformly via
// `jsonError(c, result.error)`. The message is a key of the error-message catalog,
// so it renders in the request's language; `Error.message` keeps the English text.
export class AppError extends Error {
  constructor(
    readonly httpStatus: number,
    readonly text: ErrorMessage,
    readonly meta: {
      reason?: string
      canonicalStatus?: CanonicalStatus
      metadata?: Record<string, string>
      // Server-only diagnostics. These never enter the HTTP response body.
      diagnostics?: { reason: string; message?: string }
      // Response headers the boundary must set (e.g. `Retry-After` on a 429).
      headers?: Record<string, string>
    } = {},
  ) {
    super(englishMessage(text))
    this.name = 'AppError'
  }

  localizedMessage(language: ErrorLanguage): string {
    return localizeMessage(this.text, language)
  }
}

type ExtraMeta = { metadata?: Record<string, string> }

// Shared, cross-resource business errors. Each bakes in its HTTP status + AIP-193
// reason once. Pass a resource-specific message (e.g. `notFound('Order not found')`)
// and, where relevant, `metadata`.
export const notFound = (message: ErrorMessage = 'Not found') => new AppError(404, message)
export const storageNotFound = (message: ErrorMessage = 'Storage not found') => new AppError(404, message)
export const forbidden = (message: ErrorMessage = 'Forbidden') => new AppError(403, message)
export const unauthorized = (message: ErrorMessage = 'Unauthorized') => new AppError(401, message)
export const passwordRequired = (message: ErrorMessage = 'Password required') => new AppError(401, message)
export const expired = (message: ErrorMessage = 'Expired') => new AppError(410, message)
export const conflict = (message: ErrorMessage, reason?: string) => new AppError(409, message, { reason })
export const badRequest = (message: ErrorMessage, reason?: string) => new AppError(400, message, { reason })
export const badGateway = (message: ErrorMessage, reason?: string) => new AppError(502, message, { reason })
export const internalError = (message: ErrorMessage = 'Internal error', reason?: string) =>
  new AppError(500, message, { reason })

export const payloadTooLarge = (message: ErrorMessage = 'Payload too large') =>
  new AppError(413, message, { reason: ErrorReason.PAYLOAD_TOO_LARGE })

export const rateLimited = (message: ErrorMessage, retryAfterSeconds?: number) =>
  new AppError(429, message, {
    headers: retryAfterSeconds === undefined ? undefined : { 'Retry-After': String(retryAfterSeconds) },
  })

export const unsupportedMediaType = (message: ErrorMessage = 'Unsupported media type') =>
  new AppError(415, message, { reason: ErrorReason.UNSUPPORTED_MEDIA_TYPE })

export const backgroundJobsUnavailable = () => new AppError(503, 'Background jobs are unavailable in this environment')

export const noStorage = (message: ErrorMessage = 'No storage configured') =>
  new AppError(503, message, { reason: ErrorReason.NO_STORAGE_CONFIGURED })

export const quotaExceeded = (message: ErrorMessage = 'Quota exceeded') =>
  new AppError(422, message, { reason: ErrorReason.QUOTA_EXCEEDED, canonicalStatus: 'RESOURCE_EXHAUSTED' })

export const insufficientCredits = (message: ErrorMessage = 'Insufficient credits', opts: ExtraMeta = {}) =>
  new AppError(402, message, { reason: ErrorReason.INSUFFICIENT_CREDITS, metadata: opts.metadata })

export const featureBlocked = (message: ErrorMessage = 'Feature not available', opts: ExtraMeta = {}) =>
  new AppError(402, message, { reason: ErrorReason.FEATURE_NOT_AVAILABLE, metadata: opts.metadata })
