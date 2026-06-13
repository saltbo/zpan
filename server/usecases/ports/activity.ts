// Plain, framework-free DTOs and the repository port for activity/audit events.
// No drizzle here — the port is what usecases and http see; the adapter maps rows
// into these shapes.

export interface RecordActivityInput {
  orgId: string
  userId: string
  action: string
  targetType: string
  targetId?: string
  targetName: string
  metadata?: Record<string, unknown>
}

export interface ActivityEvent {
  id: string
  orgId: string
  userId: string
  action: string
  targetType: string
  targetId: string | null
  targetName: string
  metadata: string | null
  createdAt: Date
}

export interface ActivityEventWithUser extends ActivityEvent {
  user: { id: string; name: string; image: string | null }
}

export interface AdminAuditEventWithOrg extends ActivityEventWithUser {
  orgName: string | null
}

export interface ListAdminAuditOpts {
  page?: number
  pageSize?: number
  orgId?: string
  userId?: string
  action?: string
  targetType?: string
}

export interface ActivityRepo {
  record(event: RecordActivityInput): Promise<void>
  list(
    orgId: string,
    opts: { page?: number; pageSize?: number },
  ): Promise<{ items: ActivityEventWithUser[]; total: number }>
  listAdminAudit(
    opts: ListAdminAuditOpts,
  ): Promise<{ items: AdminAuditEventWithOrg[]; total: number; page: number; pageSize: number }>
}
