import { z } from 'zod'
import { WORKSPACE_AUTHORIZATION_DETAIL_TYPE } from '../oauth'

export const workspaceAuthorizationDetailSchema = z
  .object({
    type: z.literal(WORKSPACE_AUTHORIZATION_DETAIL_TYPE),
    identifier: z.string().min(1).optional(),
  })
  .strict()

export type WorkspaceAuthorizationDetail = z.infer<typeof workspaceAuthorizationDetailSchema>

export function parseWorkspaceAuthorizationDetails(value: unknown): WorkspaceAuthorizationDetail[] {
  const parsed = typeof value === 'string' ? JSON.parse(value) : value
  return z.array(workspaceAuthorizationDetailSchema).parse(parsed)
}
