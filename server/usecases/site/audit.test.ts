import { describe, expect, it, vi } from 'vitest'
import type { AuditRepo } from '../ports'
import { listAuditEvents } from './audit'

describe('audit usecase', () => {
  it('forwards the query options to listAdminAudit', async () => {
    const result = { items: [], total: 0, page: 1, pageSize: 20 }
    const listAdminAudit = vi.fn(async () => result)
    const out = await listAuditEvents(
      { audit: { listAdminAudit } as Pick<AuditRepo, 'listAdminAudit'> },
      {
        page: 1,
        pageSize: 20,
        orgId: 'o1',
      },
    )
    expect(out).toBe(result)
    expect(listAdminAudit).toHaveBeenCalledWith({ page: 1, pageSize: 20, orgId: 'o1' })
  })
})
