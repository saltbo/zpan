import { z } from '@hono/zod-openapi'
import { pageQuerySchema } from './pagination'

export const listNotificationsQuerySchema = pageQuerySchema.extend({
  unread: z.string().optional(),
})

export type ListNotificationsQuery = z.infer<typeof listNotificationsQuerySchema>
