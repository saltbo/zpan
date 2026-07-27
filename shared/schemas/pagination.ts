import { z } from '@hono/zod-openapi'

export const cursorPageQuerySchema = z.object({
  pageSize: z.coerce.number().int().min(1).max(100).default(50),
  pageToken: z.string().min(1).optional(),
})

export type CursorPageQuery = z.infer<typeof cursorPageQuerySchema>

export const cursorPageSchema = <T extends z.ZodType>(item: T, name: string) =>
  z
    .object({
      items: z.array(item),
      nextPageToken: z.string().nullable(),
    })
    .openapi(name)

export type CursorPage<T> = {
  items: T[]
  nextPageToken: string | null
}

// Kept while existing list endpoints are migrated to the cursor contract.
export const pageQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
})

export type PageQuery = z.infer<typeof pageQuerySchema>

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
