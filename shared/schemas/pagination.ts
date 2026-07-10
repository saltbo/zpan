import { z } from '@hono/zod-openapi'

// Offset pagination is the default list contract (AIP-193 sibling concern in
// #443). Image-hosting/images deliberately uses CursorPage<T> instead because
// its append-heavy gallery needs stable keyset traversal while rows change.

// Integer, coerced query params with sane bounds. Use as `request.query`.
export const pageQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
})

export type PageQuery = z.infer<typeof pageQuerySchema>

// Build the named `Page<Item>` response component. `name` becomes the OpenAPI
// schema name (e.g. 'ObjectPage'), so each item type gets a distinct, generated
// SDK model instead of an inlined anonymous object.
export const pageSchema = <T extends z.ZodType>(item: T, name: string) =>
  z
    .object({
      items: z.array(item),
      total: z.number().int(),
      page: z.number().int(),
      pageSize: z.number().int(),
    })
    .openapi(name)

// Build the named cursor-page response used by the image-hosting gallery. The
// cursor stays opaque to clients and null is the only terminal signal.
export const cursorPageSchema = <T extends z.ZodType>(item: T, name: string) =>
  z
    .object({
      items: z.array(item),
      nextCursor: z
        .string()
        .nullable()
        .openapi({ description: 'Opaque continuation cursor; null when traversal is complete' }),
    })
    .openapi(name)

export type Page<T> = {
  items: T[]
  total: number
  page: number
  pageSize: number
}

export type CursorPage<T> = {
  items: T[]
  nextCursor: string | null
}
