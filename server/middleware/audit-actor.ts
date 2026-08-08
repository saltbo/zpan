import type { RecordAuditEventInput } from '../usecases/ports'
import type { AuthPrincipal } from './platform'

export type AuditActor = Pick<RecordAuditEventInput, 'userId' | 'actorType' | 'actorRef' | 'actorIssuer'>

export function auditActor(principal: AuthPrincipal | null): AuditActor {
  if (!principal) return { userId: null, actorType: 'anonymous', actorRef: null, actorIssuer: null }
  if (principal.kind === 'user') {
    return { userId: principal.userId, actorType: 'user', actorRef: null, actorIssuer: null }
  }
  if (principal.kind === 'api-key') {
    return { userId: principal.userId, actorType: 'api_key', actorRef: principal.keyId, actorIssuer: null }
  }
  if (principal.kind === 'oauth') {
    return {
      userId: principal.userId,
      actorType: 'oauth',
      actorRef: principal.actorSubject,
      actorIssuer: principal.actorIssuer,
    }
  }
  if (principal.kind === 'downloader') {
    return { userId: null, actorType: 'device', actorRef: principal.downloaderId, actorIssuer: null }
  }
  if (principal.kind === 'downloader-bootstrap') {
    return { userId: principal.userId, actorType: 'user', actorRef: null, actorIssuer: null }
  }
  return {
    userId: principal.createdByUserId,
    actorType: 'device',
    actorRef: principal.downloaderId,
    actorIssuer: null,
  }
}
