import type { RecordAuditEventInput } from '../usecases/ports'
import type { AuthPrincipal } from './platform'

export type AuditActor = Pick<RecordAuditEventInput, 'userId' | 'actorType' | 'actorRef'>

export function auditActor(principal: AuthPrincipal | null): AuditActor {
  if (!principal) return { userId: null, actorType: 'anonymous', actorRef: null }
  if (principal.kind === 'user') return { userId: principal.userId, actorType: 'user', actorRef: null }
  if (principal.kind === 'api-key') {
    return { userId: principal.userId, actorType: 'api_key', actorRef: principal.keyId }
  }
  if (principal.kind === 'agent-oauth') {
    return { userId: principal.userId, actorType: 'agent_oauth', actorRef: principal.grantId }
  }
  if (principal.kind === 'downloader') {
    return { userId: null, actorType: 'downloader', actorRef: principal.downloaderId }
  }
  if (principal.kind === 'downloader-bootstrap') {
    return { userId: principal.userId, actorType: 'user', actorRef: null }
  }
  return { userId: principal.createdByUserId, actorType: 'task-upload', actorRef: principal.taskId }
}
