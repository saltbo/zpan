import { z } from '@hono/zod-openapi'

// One pagination contract for the whole API (AIP-193 sibling concern in #443):
// every list endpoint returns `Page<T> = { items, total, page, pageSize }` and
// accepts integer `page`/`pageSize` query params. The only intentional exception
// is image-hosting/images, which stays cursor-paginated for large galleries.

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

export type Page<T> = {
  items: T[]
  total: number
  page: number
  pageSize: number
}
