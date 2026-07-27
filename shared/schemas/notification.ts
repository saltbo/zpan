import { z } from '@hono/zod-openapi'
import { cursorPageQuerySchema } from './pagination'

export const listNotificationsQuerySchema = cursorPageQuerySchema.extend({
  unread: z.string().optional(),
})

export type ListNotificationsQuery = z.infer<typeof listNotificationsQuerySchema>
