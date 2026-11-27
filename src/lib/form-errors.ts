import type { FieldPath, FieldValues, UseFormSetError } from 'react-hook-form'
import { ApiError } from '@/lib/api'

// Request field path, as the server names it in `metadata.field` (such as
// `manual.records.0.value`), to the form field that holds it. A key also matches
// every path below it, so `manual.records` covers each record.
export type ServerFieldMap<F extends string> = Readonly<Record<string, F>>

export type ServerFieldError<F extends string> = { field: F; message: string }

// The form field a rejected request belongs to, or undefined when the error names
// no field this form shows. The longest matching key wins.
export function serverFieldError<F extends string>(
  error: unknown,
  fields: ServerFieldMap<F>,
): ServerFieldError<F> | undefined {
  if (!(error instanceof ApiError)) return undefined
  const path = error.metadata?.field
  if (!path) return undefined
  let match: string | undefined
  for (const key of Object.keys(fields)) {
    if ((path === key || path.startsWith(`${key}.`)) && key.length > (match?.length ?? -1)) match = key
  }
  return match === undefined ? undefined : { field: fields[match], message: error.message }
}

// The message for above the submit button: any error that does not belong under a field.
export function formLevelError(error: unknown, fields: ServerFieldMap<string>): string | null {
  if (!error || serverFieldError(error, fields)) return null
  return error instanceof Error ? error.message : String(error)
}

// Puts a field-specific server error under its react-hook-form field. Returns
// whether it did, so the caller keeps a form-level message otherwise.
export function setServerFieldError<T extends FieldValues>(
  setError: UseFormSetError<T>,
  error: unknown,
  fields: ServerFieldMap<FieldPath<T>>,
): boolean {
  const fieldError = serverFieldError(error, fields)
  if (!fieldError) return false
  setError(fieldError.field, { type: 'server', message: fieldError.message })
  return true
}
