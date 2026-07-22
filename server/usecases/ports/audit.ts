// Plain, framework-free DTOs and the repository port for audit events.

export type AuditActorType = 'user' | 'api_key' | 'anonymous' | 'system' | 'downloader'

export interface RecordAuditEventInput {
  orgId: string
  userId?: string | null
  actorType?: AuditActorType
  actorRef?: string | null
  action: string
  targetType: string
  targetId?: string
  targetName: string
  metadata?: Record<string, unknown>
}

export interface AuditEvent {
  id: string
  orgId: string
  userId: string | null
  actorType: AuditActorType
  actorRef: string | null
  action: string
  targetType: string
  targetId: string | null
  targetName: string
  metadata: string | null
  createdAt: Date
}

export interface AuditEventWithUser extends AuditEvent {
  user: { id: string | null; name: string; image: string | null }
}

export interface AdminAuditEventWithOrg extends AuditEventWithUser {
  orgName: string | null
}

export interface ListAdminAuditOpts {
  page?: number
  pageSize?: number
  orgId?: string
  userId?: string
  action?: string
  targetType?: string
  createdFrom?: Date
  createdTo?: Date
}

export interface ListAuditByTargetOpts {
  orgId: string
  targetType: string
  targetId: string
  page?: number
  pageSize?: number
}

export interface AuditRepo {
  record(event: RecordAuditEventInput): Promise<void>
  recordOnce(event: RecordAuditEventInput, idempotencyKey: string, occurredAt?: Date): Promise<void>
  list(
    orgId: string,
    opts: { page?: number; pageSize?: number },
  ): Promise<{ items: AuditEventWithUser[]; total: number }>
  listAdminAudit(
    opts: ListAdminAuditOpts,
  ): Promise<{ items: AdminAuditEventWithOrg[]; total: number; page: number; pageSize: number }>
  listByTarget(
    opts: ListAuditByTargetOpts,
  ): Promise<{ items: AuditEvent[]; total: number; page: number; pageSize: number }>
}
