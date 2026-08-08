// The admin audit resource usecase (/api/admin/audit). Reads org-joined
// activity events and resolves their display-only actor projection. It lives
// here so the resource has one home and the http handler stays free of deps access.

import { resolveAuditActorProfiles } from '../audit-actors'
import type {
  AdminAuditEventWithOrg,
  AgentInfoGateway,
  AuditActorDirectory,
  AuditRepo,
  ListAdminAuditOpts,
} from '../ports'

export async function listAuditEvents(
  deps: {
    audit: Pick<AuditRepo, 'listAdminAudit'>
    auditActorDirectory: AuditActorDirectory
    agentInfo: AgentInfoGateway
  },
  opts: ListAdminAuditOpts,
): Promise<{ items: AdminAuditEventWithOrg[]; total: number; page: number; pageSize: number }> {
  const result = await deps.audit.listAdminAudit(opts)
  const items = await resolveAuditActorProfiles(deps, result.items)
  if (items === result.items) return result
  return { ...result, items }
}
