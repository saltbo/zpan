import { z } from 'zod'

// Schemas for list state kept in the URL (UX.md, Lists). A value the page cannot
// use reads as absent, so a hand-edited or stale link falls back to the default view.

// The router parses `?q=123` as a number, so a number is read back as the text typed.
export const textParam = z
  .union([z.string(), z.number()])
  .transform((value) => String(value) || undefined)
  .optional()
  .catch(undefined)

export const pageParam = z.coerce.number().int().min(1).optional().catch(undefined)

export function enumParam<const T extends readonly [string, ...string[]]>(values: T) {
  return z.enum(values).optional().catch(undefined)
}

export function numberOptionParam(values: readonly number[]) {
  return z.coerce
    .number()
    .refine((value) => values.includes(value))
    .optional()
    .catch(undefined)
}
