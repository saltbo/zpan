// Plain, framework-free DTOs and the repository port for audit events.

import type { ActorAttribution, ActorType } from '@shared/schemas'

export type AuditActorType = ActorType

export interface RecordAuditEventInput {
  orgId: string
  userId?: string | null
  actorType?: AuditActorType
  actorRef?: string | null
  actorIssuer?: string | null
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
  actorIssuer: string | null
  action: string
  targetType: string
  targetId: string | null
  targetName: string
  metadata: string | null
  createdAt: Date
}

export interface AuditEventWithUser extends AuditEvent {
  user: { id: string | null; name: string; image: string | null }
  actor: AuditActorProfile
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

export interface ActorIdentity {
  type: ActorType
  ref: string | null
  issuer: string | null
}

export interface ActorProfile {
  name: string
  image: string | null
  resolved: boolean
}

export interface ActorDirectory {
  findUserProfiles(userIds: readonly string[]): Promise<ReadonlyMap<string, ActorProfile>>
  findApiKeyNames(keyIds: readonly string[]): Promise<ReadonlyMap<string, string>>
  findDeviceNames(deviceIds: readonly string[]): Promise<ReadonlyMap<string, string>>
  listTrustedAgentIssuerOrigins(): Promise<ReadonlySet<string>>
}

export interface AgentInfoGateway {
  // Profiles are display-only and never authoritative. An omitted identity
  // tells the caller to retain the stable issuer/subject fallback.
  resolve(
    actors: readonly ActorIdentity[],
    trustedIssuerOrigins: ReadonlySet<string>,
  ): Promise<ReadonlyMap<string, ActorProfile>>
}

export type AuditActorIdentity = ActorIdentity
export type AuditActorProfile = ActorProfile
export type AuditActorDirectory = ActorDirectory
export type { ActorAttribution }

export function actorIdentityKey(actor: ActorIdentity): string {
  return JSON.stringify([actor.type, actor.issuer, actor.ref])
}

export const auditActorIdentityKey = actorIdentityKey
