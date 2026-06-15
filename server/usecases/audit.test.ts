import { describe, expect, it, vi } from 'vitest'
import { listAuditEvents } from './audit'
import type { ActivityRepo } from './ports'

describe('audit usecase', () => {
  it('forwards the query options to listAdminAudit', async () => {
    const result = { items: [], total: 0, page: 1, pageSize: 20 }
    const listAdminAudit = vi.fn(async () => result)
    const out = await listAuditEvents(
      { activity: { listAdminAudit } as Pick<ActivityRepo, 'listAdminAudit'> },
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
