import type { AnnouncementInput } from '@shared/schemas'
import { describe, expect, it, vi } from 'vitest'
import type { AnnouncementRecord, AnnouncementRepo } from '../ports'
import {
  createAnnouncement,
  deleteAnnouncement,
  getAnnouncement,
  listAdminAnnouncements,
  listUserAnnouncements,
  updateAnnouncement,
} from './announcement'

const sample = { id: 'a1', title: 'Hi' } as AnnouncementRecord
const input = { title: 'Hi', body: 'Body' } as AnnouncementInput

function repo(over: Partial<AnnouncementRepo> = {}): { announcements: AnnouncementRepo } {
  return {
    announcements: {
      create: vi.fn(async () => sample),
      listAdmin: vi.fn(async () => ({ items: [], total: 0, page: 1, pageSize: 20 })),
      get: vi.fn(async () => sample),
      update: vi.fn(async () => sample),
      delete: vi.fn(async () => true),
      listUser: vi.fn(async () => ({ items: [], total: 0, page: 1, pageSize: 20 })),
      ...over,
    } as AnnouncementRepo,
  }
}

describe('announcement usecase', () => {
  it('lists user announcements with the given filter', async () => {
    const listUser = vi.fn(async () => ({ items: [sample], total: 1, page: 1, pageSize: 20 }))
    const out = await listUserAnnouncements(repo({ listUser }), { activeOnly: true, page: 1, pageSize: 20 })
    expect(out.total).toBe(1)
    expect(listUser).toHaveBeenCalledWith({ activeOnly: true, page: 1, pageSize: 20 })
  })

  it('lists admin announcements', async () => {
    const listAdmin = vi.fn(async () => ({ items: [], total: 0, page: 1, pageSize: 20 }))
    await listAdminAnnouncements(repo({ listAdmin }), { page: 2, pageSize: 50 })
    expect(listAdmin).toHaveBeenCalledWith({ page: 2, pageSize: 50 })
  })

  it('creates with the author id', async () => {
    const create = vi.fn(async () => sample)
    await createAnnouncement(repo({ create }), input, 'u1')
    expect(create).toHaveBeenCalledWith(input, 'u1')
  })

  it('returns null when getting a missing announcement', async () => {
    expect(await getAnnouncement(repo({ get: vi.fn(async () => null) }), 'x')).toBeNull()
  })

  it('updates by id', async () => {
    const update = vi.fn(async () => sample)
    expect(await updateAnnouncement(repo({ update }), 'a1', input)).toBe(sample)
    expect(update).toHaveBeenCalledWith('a1', input)
  })

  it('reports whether a delete removed a row', async () => {
    expect(await deleteAnnouncement(repo({ delete: vi.fn(async () => false) }), 'x')).toBe(false)
  })
})
