import { type Hook, OpenAPIHono } from '@hono/zod-openapi'
import { jsonError } from '../middleware/error-handler'
import type { Env } from '../middleware/platform'
import { AppError, isCatalogMessage, msg, textMessage } from '../usecases/ports'

type ValidationIssue = { path: PropertyKey[]; message: string }

// Every router is created here, so a request that fails its route's schema answers
// with the same AIP-193 body as every other error instead of zod's raw issue list.
export function createRouter() {
  return new OpenAPIHono<Env>({ defaultHook: validationHook })
}

export const validationHook: Hook<unknown, Env, string, Response | undefined> = (result, c) => {
  if (result.success) return
  return jsonError(c, validationError(result.error.issues))
}

// The first issue becomes one readable sentence naming its field. A schema's own
// message is shown when the catalog translates it; zod's built-in wording is not
// written for users, so it falls back to a generic sentence. The whole issue list
// goes to the access log only.
export function validationError(issues: readonly ValidationIssue[]): AppError {
  const first = issues[0]
  const field = first?.path.map(String).join('.') ?? ''
  const text = first && isCatalogMessage(first.message) ? textMessage(first.message) : genericMessage(field)
  return new AppError(400, text, {
    metadata: field ? { field } : undefined,
    diagnostics: {
      reason: 'VALIDATION_FAILED',
      message: JSON.stringify(issues.map((issue) => ({ path: issue.path.map(String), message: issue.message }))),
    },
  })
}

const genericMessage = (field: string) => (field ? msg('Invalid value for {field}', { field }) : 'Invalid request')
