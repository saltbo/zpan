// The admin audit resource usecase (/api/admin/audit). Reads org-joined
// activity events. A single-port operation today; it lives here so the resource
// has one home and the http handler stays free of deps access.

import type { AdminAuditEventWithOrg, AuditRepo, ListAdminAuditOpts } from '../ports'

export function listAuditEvents(
  deps: { audit: Pick<AuditRepo, 'listAdminAudit'> },
  opts: ListAdminAuditOpts,
): Promise<{ items: AdminAuditEventWithOrg[]; total: number; page: number; pageSize: number }> {
  return deps.audit.listAdminAudit(opts)
}
