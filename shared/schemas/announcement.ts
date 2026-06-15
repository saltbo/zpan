import { z } from 'zod'

export const announcementStatusSchema = z.enum(['draft', 'published', 'archived'])

export const listAnnouncementsQuerySchema = z.object({
  // `active` = the caller's live feed (any authed user); `all` = full management
  // list (admin only). Absent = live feed.
  scope: z.enum(['active', 'all']).optional(),
  status: announcementStatusSchema.optional(),
  page: z.string().regex(/^\d+$/).optional(),
  pageSize: z.string().regex(/^\d+$/).optional(),
})

export const listAdminAnnouncementsQuerySchema = z.object({
  status: announcementStatusSchema.optional(),
  page: z.string().regex(/^\d+$/).optional(),
  pageSize: z.string().regex(/^\d+$/).optional(),
})

export const announcementInputSchema = z.object({
  title: z.string().min(1).max(120),
  body: z.string().max(5000).default(''),
  status: announcementStatusSchema,
  priority: z.number().int().min(0).max(100).default(0),
})

export type AnnouncementStatus = z.infer<typeof announcementStatusSchema>
export type AnnouncementInput = z.infer<typeof announcementInputSchema>
export type ListAnnouncementsQuery = z.infer<typeof listAnnouncementsQuerySchema>
export type ListAdminAnnouncementsQuery = z.infer<typeof listAdminAnnouncementsQuerySchema>
