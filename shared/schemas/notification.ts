import { z } from 'zod'

export const listNotificationsQuerySchema = z.object({
  page: z.string().optional(),
  pageSize: z.string().optional(),
  unread: z.string().optional(),
})

export type ListNotificationsQuery = z.infer<typeof listNotificationsQuerySchema>
