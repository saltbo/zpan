// Tests for src/lib/api.ts — covers all public API helper functions
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  batchDeleteObjects,
  batchMoveObjects,
  batchTrashObjects,
  buildShareObjectUrl,
  confirmIhostImage,
  confirmUpload,
  connectCloud,
  copyObject,
  createIhostApiKey,
  createIhostImagePresign,
  createObject,
  createShare,
  createSiteInvitation,
  createStorage,
  deleteAvatar,
  deleteIhostConfig,
  deleteIhostImage,
  deleteObject,
  deleteShare,
  deleteStorage,
  deleteTeamLogo,
  deleteUser,
  disconnectCloud,
  emptyTrash,
  enableIhostFeature,
  getBranding,
  getEmailConfig,
  getIhostConfig,
  getLicensingStatus,
  getObject,
  getProfile,
  getSession,
  getShare,
  getSiteInvitation,
  getStorage,
  getSystemOption,
  getUnreadCount,
  getUserQuota,
  listAuthProviders,
  listIhostApiKeys,
  listIhostImages,
  listNotifications,
  listObjects,
  listQuotas,
  listShareObjects,
  listShares,
  listSiteInvitations,
  listStorages,
  listSystemOptions,
  listUsers,
  markAllNotificationsRead,
  markNotificationRead,
  pollPairing,
  refreshLicense,
  resendSiteInvitation,
  resetBrandingField,
  restoreObject,
  revokeIhostApiKey,
  revokeSiteInvitation,
  saveBranding,
  saveEmailConfig,
  saveShareToDrive,
  setSystemOption,
  testEmail,
  trashObject,
  updateIhostConfig,
  updateObject,
  updateQuota,
  updateStorage,
  updateUserStatus,
  uploadAvatar,
  uploadTeamLogo,
  uploadToS3,
  verifySharePassword,
} from './api'

function makeResponse(body: unknown, ok = true, status = 200): Response {
  return {
    ok,
    status,
    statusText: ok ? 'OK' : 'Bad Request',
    json: async () => body,
  } as unknown as Response
}

describe('api', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn())
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  describe('listObjects', () => {
    it('calls correct URL with defaults', async () => {
      const fetchMock = vi.mocked(fetch)
      fetchMock.mockResolvedValueOnce(makeResponse({ items: [], total: 0, page: 1, pageSize: 500 }))

      await listObjects('root')

      const [url] = fetchMock.mock.calls[0] as [string, RequestInit]
      expect(url).toContain('/api/objects?')
      expect(url).toContain('parent=root')
      expect(url).toContain('status=active')
      expect(url).toContain('page=1')
      expect(url).toContain('pageSize=500')
    })

    it('uses provided status, page, and pageSize', async () => {
      const fetchMock = vi.mocked(fetch)
      fetchMock.mockResolvedValueOnce(makeResponse({ items: [], total: 0, page: 2, pageSize: 20 }))

      await listObjects('folder1', 'trashed', 2, 20)

      const [url] = fetchMock.mock.calls[0] as [string, RequestInit]
      expect(url).toContain('status=trashed')
      expect(url).toContain('page=2')
      expect(url).toContain('pageSize=20')
    })

    it('returns parsed paginated response', async () => {
      const payload = { items: [{ id: 'abc' }], total: 1, page: 1, pageSize: 500 }
      vi.mocked(fetch).mockResolvedValueOnce(makeResponse(payload))

      const result = await listObjects('root')

      expect(result).toEqual(payload)
    })

    it('throws when response is not ok', async () => {
      vi.mocked(fetch).mockResolvedValueOnce(makeResponse({ error: 'forbidden' }, false, 403))

      await expect(listObjects('root')).rejects.toThrow('forbidden')
    })

    it('falls back to statusText when error body has no error field', async () => {
      vi.mocked(fetch).mockResolvedValueOnce(makeResponse({}, false, 500))

      await expect(listObjects('root')).rejects.toThrow('Bad Request')
    })

    it('falls back to statusText when json parse fails', async () => {
      const res = {
        ok: false,
        statusText: 'Service Unavailable',
        json: async () => {
          throw new Error('parse error')
        },
      } as unknown as Response
      vi.mocked(fetch).mockResolvedValueOnce(res)

      await expect(listObjects('root')).rejects.toThrow('Service Unavailable')
    })

    it('passes credentials: include', async () => {
      vi.mocked(fetch).mockResolvedValueOnce(makeResponse({ items: [], total: 0, page: 1, pageSize: 500 }))

      await listObjects('root')

      const [, init] = vi.mocked(fetch).mock.calls[0] as [string, RequestInit]
      expect(init.credentials).toBe('include')
    })
  })

  describe('getObject', () => {
    it('fetches object by id', async () => {
      const obj = { id: 'id1', name: 'file.txt', downloadUrl: 'https://s3/file.txt' }
      vi.mocked(fetch).mockResolvedValueOnce(makeResponse(obj))

      const result = await getObject('id1')

      expect(result).toEqual(obj)
      const [url] = vi.mocked(fetch).mock.calls[0] as [string]
      expect(url).toBe('/api/objects/id1')
    })

    it('throws on error response', async () => {
      vi.mocked(fetch).mockResolvedValueOnce(makeResponse({ error: 'not found' }, false, 404))

      await expect(getObject('missing')).rejects.toThrow('not found')
    })
  })

  describe('site invitations api', () => {
    it('lists site invitations with pagination', async () => {
      vi.mocked(fetch).mockResolvedValueOnce(makeResponse({ items: [], total: 0 }))

      await listSiteInvitations(2, 10)

      const [url, init] = vi.mocked(fetch).mock.calls[0] as [string, RequestInit]
      expect(url).toContain('/api/admin/site-invitations?')
      expect(url).toContain('page=2')
      expect(url).toContain('pageSize=10')
      expect(init.method).toBe('GET')
    })

    it('creates a site invitation', async () => {
      vi.mocked(fetch).mockResolvedValueOnce(makeResponse({ id: 'invite-1', email: 'new@example.com' }))

      await createSiteInvitation('new@example.com')

      const [url, init] = vi.mocked(fetch).mock.calls[0] as [string, RequestInit]
      expect(url).toContain('/api/admin/site-invitations')
      expect(init.method).toBe('POST')
      expect(init.body).toBe(JSON.stringify({ email: 'new@example.com' }))
    })

    it('resends a site invitation', async () => {
      vi.mocked(fetch).mockResolvedValueOnce(makeResponse({ id: 'invite-1', email: 'new@example.com' }))

      await resendSiteInvitation('invite-1')

      const [url, init] = vi.mocked(fetch).mock.calls[0] as [string, RequestInit]
      expect(url).toBe('/api/admin/site-invitations/invite-1/resend')
      expect(init.method).toBe('POST')
    })

    it('revokes a site invitation', async () => {
      vi.mocked(fetch).mockResolvedValueOnce(makeResponse({ id: 'invite-1', revoked: true }))

      await revokeSiteInvitation('invite-1')

      const [url, init] = vi.mocked(fetch).mock.calls[0] as [string, RequestInit]
      expect(url).toBe('/api/admin/site-invitations/invite-1')
      expect(init.method).toBe('DELETE')
    })

    it('gets a public site invitation by token', async () => {
      vi.mocked(fetch).mockResolvedValueOnce(makeResponse({ id: 'invite-1', token: 'token-1' }))

      await getSiteInvitation('token-1')

      const [url, init] = vi.mocked(fetch).mock.calls[0] as [string, RequestInit]
      expect(url).toBe('/api/site-invitations/token-1')
      expect(init.method).toBe('GET')
    })

    it('throws ApiError for failed site invitation create', async () => {
      vi.mocked(fetch).mockResolvedValueOnce(makeResponse({ error: 'duplicate invitation' }, false, 409))

      await expect(createSiteInvitation('new@example.com')).rejects.toThrow('duplicate invitation')
    })
  })

  describe('createObject', () => {
    it('posts to /api/objects with JSON body', async () => {
      const created = { id: 'new1', name: 'doc.pdf', uploadUrl: 'https://s3/presigned' }
      vi.mocked(fetch).mockResolvedValueOnce(makeResponse(created))

      const result = await createObject({
        name: 'doc.pdf',
        type: 'application/pdf',
        size: 1024,
        parent: 'root',
        dirtype: 0,
      })

      expect(result).toEqual(created)
      const [url, init] = vi.mocked(fetch).mock.calls[0] as [string, RequestInit]
      expect(url).toContain('/api/objects')
      expect(init.method).toBe('POST')
      const body = typeof init.body === 'string' ? JSON.parse(init.body) : null
      expect(body).toMatchObject({ name: 'doc.pdf', type: 'application/pdf', size: 1024, parent: 'root', dirtype: 0 })
      const headers =
        init.headers instanceof Headers ? init.headers : new Headers(init.headers as Record<string, string>)
      expect(headers.get('Content-Type')).toContain('application/json')
    })

    it('throws on error response', async () => {
      vi.mocked(fetch).mockResolvedValueOnce(makeResponse({ error: 'quota exceeded' }, false, 422))

      await expect(createObject({ name: 'f', type: 't', parent: 'p', dirtype: 0 })).rejects.toThrow('quota exceeded')
    })
  })

  describe('updateObject', () => {
    it('patches object by id with name', async () => {
      const updated = { id: 'id1', name: 'renamed.txt' }
      vi.mocked(fetch).mockResolvedValueOnce(makeResponse(updated))

      const result = await updateObject('id1', { name: 'renamed.txt' })

      expect(result).toEqual(updated)
      const [url, init] = vi.mocked(fetch).mock.calls[0] as [string, RequestInit]
      expect(url).toBe('/api/objects/id1')
      expect(init.method).toBe('PATCH')
      expect(init.body).toBe(JSON.stringify({ action: 'update', name: 'renamed.txt' }))
    })

    it('patches object by id with parent', async () => {
      const updated = { id: 'id1', parent: 'folder2' }
      vi.mocked(fetch).mockResolvedValueOnce(makeResponse(updated))

      await updateObject('id1', { parent: 'folder2' })

      const [, init] = vi.mocked(fetch).mock.calls[0] as [string, RequestInit]
      expect(init.body).toBe(JSON.stringify({ action: 'update', parent: 'folder2' }))
    })

    it('throws on error response', async () => {
      vi.mocked(fetch).mockResolvedValueOnce(makeResponse({ error: 'forbidden' }, false, 403))

      await expect(updateObject('id1', { name: 'x' })).rejects.toThrow('forbidden')
    })
  })

  describe('confirmUpload', () => {
    it('patches with action: confirm', async () => {
      const obj = { id: 'id1', status: 'active' }
      vi.mocked(fetch).mockResolvedValueOnce(makeResponse(obj))

      const result = await confirmUpload('id1')

      expect(result).toEqual(obj)
      const [url, init] = vi.mocked(fetch).mock.calls[0] as [string, RequestInit]
      expect(url).toBe('/api/objects/id1')
      expect(init.method).toBe('PATCH')
      const body = typeof init.body === 'string' ? JSON.parse(init.body) : null
      expect(body).toMatchObject({ action: 'confirm' })
    })

    it('throws on error response', async () => {
      vi.mocked(fetch).mockResolvedValueOnce(makeResponse({ error: 'not found' }, false, 404))

      await expect(confirmUpload('missing')).rejects.toThrow('not found')
    })
  })

  describe('deleteObject', () => {
    it('sends DELETE request and returns deleted flag', async () => {
      const payload = { id: 'id1', deleted: true }
      vi.mocked(fetch).mockResolvedValueOnce(makeResponse(payload))

      const result = await deleteObject('id1')

      expect(result).toEqual(payload)
      const [url, init] = vi.mocked(fetch).mock.calls[0] as [string, RequestInit]
      expect(url).toBe('/api/objects/id1')
      expect(init.method).toBe('DELETE')
    })

    it('throws on error response', async () => {
      vi.mocked(fetch).mockResolvedValueOnce(makeResponse({ error: 'not found' }, false, 404))

      await expect(deleteObject('missing')).rejects.toThrow('not found')
    })
  })

  describe('copyObject', () => {
    it('posts to /copy endpoint with copyFrom and parent in body', async () => {
      const copy = { id: 'copy1', name: 'file.txt' }
      vi.mocked(fetch).mockResolvedValueOnce(makeResponse(copy))

      const result = await copyObject('id1', 'folder2')

      expect(result).toEqual(copy)
      const [url, init] = vi.mocked(fetch).mock.calls[0] as [string, RequestInit]
      expect(url).toContain('/api/objects/copy')
      expect(init.method).toBe('POST')
      const body = typeof init.body === 'string' ? JSON.parse(init.body) : null
      expect(body).toMatchObject({ copyFrom: 'id1', parent: 'folder2' })
      const headers =
        init.headers instanceof Headers ? init.headers : new Headers(init.headers as Record<string, string>)
      expect(headers.get('Content-Type')).toContain('application/json')
    })

    it('throws on error response', async () => {
      vi.mocked(fetch).mockResolvedValueOnce(makeResponse({ error: 'conflict' }, false, 409))

      await expect(copyObject('id1', 'folder2')).rejects.toThrow('conflict')
    })
  })

  describe('uploadToS3', () => {
    it('PUTs file to presigned URL with correct content-type', async () => {
      vi.mocked(fetch).mockResolvedValueOnce(makeResponse(null, true))

      const file = new File(['hello'], 'hello.txt', { type: 'text/plain' })
      await uploadToS3('https://s3/presigned', file)

      const [url, init] = vi.mocked(fetch).mock.calls[0] as [string, RequestInit]
      expect(url).toBe('https://s3/presigned')
      expect(init.method).toBe('PUT')
      expect(init.body).toBe(file)
      expect((init.headers as Record<string, string>)['Content-Type']).toBe('text/plain')
    })

    it('falls back to application/octet-stream when file type is empty', async () => {
      vi.mocked(fetch).mockResolvedValueOnce(makeResponse(null, true))

      const file = new File(['data'], 'blob') // no type
      await uploadToS3('https://s3/presigned', file)

      const [, init] = vi.mocked(fetch).mock.calls[0] as [string, RequestInit]
      expect((init.headers as Record<string, string>)['Content-Type']).toBe('application/octet-stream')
    })

    it('does not pass credentials on S3 upload', async () => {
      vi.mocked(fetch).mockResolvedValueOnce(makeResponse(null, true))

      const file = new File(['x'], 'x.bin')
      await uploadToS3('https://s3/presigned', file)

      const [, init] = vi.mocked(fetch).mock.calls[0] as [string, RequestInit]
      expect((init as RequestInit).credentials).toBeUndefined()
    })

    it('throws when S3 upload fails', async () => {
      vi.mocked(fetch).mockResolvedValueOnce(makeResponse(null, false, 403))

      const file = new File(['x'], 'x.bin')
      await expect(uploadToS3('https://s3/presigned', file)).rejects.toThrow('Upload failed')
    })
  })

  describe('restoreObject', () => {
    it('sends PATCH with action: restore for the given id', async () => {
      const obj = { id: 'id1', status: 'active' }
      vi.mocked(fetch).mockResolvedValueOnce(makeResponse(obj))

      const result = await restoreObject('id1')

      expect(result).toEqual(obj)
      const [url, init] = vi.mocked(fetch).mock.calls[0] as [string, RequestInit]
      expect(url).toContain('/api/objects/id1')
      expect(init.method).toBe('PATCH')
      const body = typeof init.body === 'string' ? JSON.parse(init.body) : null
      expect(body).toMatchObject({ action: 'restore' })
    })

    it('throws on error response', async () => {
      vi.mocked(fetch).mockResolvedValueOnce(makeResponse({ error: 'not found' }, false, 404))

      await expect(restoreObject('missing')).rejects.toThrow('not found')
    })
  })

  describe('emptyTrash', () => {
    it('sends DELETE to trash endpoint', async () => {
      const payload = { purged: 5 }
      vi.mocked(fetch).mockResolvedValueOnce(makeResponse(payload))

      const result = await emptyTrash()

      expect(result).toEqual(payload)
      const [url, init] = vi.mocked(fetch).mock.calls[0] as [string, RequestInit]
      expect(url).toContain('/api/trash')
      expect(init.method).toBe('DELETE')
    })

    it('throws on error response', async () => {
      vi.mocked(fetch).mockResolvedValueOnce(makeResponse({ error: 'server error' }, false, 500))

      await expect(emptyTrash()).rejects.toThrow('server error')
    })
  })

  describe('listStorages', () => {
    it('fetches storages list', async () => {
      const payload = { items: [{ id: 's1', name: 'main' }], total: 1 }
      vi.mocked(fetch).mockResolvedValueOnce(makeResponse(payload))

      const result = await listStorages()

      expect(result).toEqual(payload)
      const [url] = vi.mocked(fetch).mock.calls[0] as [string]
      expect(url).toContain('/api/admin/storages')
    })

    it('throws on error response', async () => {
      vi.mocked(fetch).mockResolvedValueOnce(makeResponse({ error: 'forbidden' }, false, 403))

      await expect(listStorages()).rejects.toThrow('forbidden')
    })
  })

  describe('createStorage', () => {
    const validInput = {
      title: 'minio',
      mode: 'private' as const,
      bucket: 'files',
      endpoint: 'https://minio.example.com',
      region: 'us-east-1',
      accessKey: 'key',
      secretKey: 'secret',
      capacity: 1073741824,
    }

    it('posts storage data and returns created storage', async () => {
      const storage = { id: 's1', title: 'minio', bucket: 'files' }
      vi.mocked(fetch).mockResolvedValueOnce(makeResponse(storage))

      const result = await createStorage(validInput)

      expect(result).toEqual(storage)
      const [url, init] = vi.mocked(fetch).mock.calls[0] as [string, RequestInit]
      expect(url).toContain('/api/admin/storages')
      expect(init.method).toBe('POST')
      const body = typeof init.body === 'string' ? JSON.parse(init.body) : null
      expect(body).toMatchObject({ title: 'minio', bucket: 'files' })
      const headers =
        init.headers instanceof Headers ? init.headers : new Headers(init.headers as Record<string, string>)
      expect(headers.get('Content-Type')).toContain('application/json')
    })

    it('throws on error response', async () => {
      vi.mocked(fetch).mockResolvedValueOnce(makeResponse({ error: 'conflict' }, false, 409))

      await expect(createStorage(validInput)).rejects.toThrow('conflict')
    })
  })

  describe('getStorage', () => {
    it('fetches storage by id', async () => {
      const storage = { id: 's1', name: 'minio' }
      vi.mocked(fetch).mockResolvedValueOnce(makeResponse(storage))

      const result = await getStorage('s1')

      expect(result).toEqual(storage)
      const [url] = vi.mocked(fetch).mock.calls[0] as [string]
      expect(url).toContain('/api/admin/storages/s1')
    })

    it('throws on error response', async () => {
      vi.mocked(fetch).mockResolvedValueOnce(makeResponse({ error: 'not found' }, false, 404))

      await expect(getStorage('missing')).rejects.toThrow('not found')
    })
  })

  describe('updateStorage', () => {
    it('puts updated storage data and returns updated storage', async () => {
      const storage = { id: 's1', title: 'updated-minio' }
      vi.mocked(fetch).mockResolvedValueOnce(makeResponse(storage))

      const result = await updateStorage('s1', { title: 'updated-minio' })

      expect(result).toEqual(storage)
      const [url, init] = vi.mocked(fetch).mock.calls[0] as [string, RequestInit]
      expect(url).toContain('/api/admin/storages/s1')
      expect(init.method).toBe('PUT')
      const body = typeof init.body === 'string' ? JSON.parse(init.body) : null
      expect(body).toMatchObject({ title: 'updated-minio' })
    })

    it('throws on error response', async () => {
      vi.mocked(fetch).mockResolvedValueOnce(makeResponse({ error: 'forbidden' }, false, 403))

      await expect(updateStorage('s1', { title: 'x' })).rejects.toThrow('forbidden')
    })
  })

  describe('deleteStorage', () => {
    it('sends DELETE request and returns deleted flag', async () => {
      const payload = { id: 's1', deleted: true }
      vi.mocked(fetch).mockResolvedValueOnce(makeResponse(payload))

      const result = await deleteStorage('s1')

      expect(result).toEqual(payload)
      const [url, init] = vi.mocked(fetch).mock.calls[0] as [string, RequestInit]
      expect(url).toContain('/api/admin/storages/s1')
      expect(init.method).toBe('DELETE')
    })

    it('throws on error response', async () => {
      vi.mocked(fetch).mockResolvedValueOnce(makeResponse({ error: 'not found' }, false, 404))

      await expect(deleteStorage('missing')).rejects.toThrow('not found')
    })
  })

  describe('listUsers', () => {
    it('fetches users with page and pageSize query params', async () => {
      const payload = { items: [{ id: 'u1', name: 'Alice' }], total: 1 }
      vi.mocked(fetch).mockResolvedValueOnce(makeResponse(payload))

      const result = await listUsers(2, 20)

      expect(result).toEqual(payload)
      const [url] = vi.mocked(fetch).mock.calls[0] as [string]
      expect(url).toContain('/api/admin/users')
      expect(url).toContain('page=2')
      expect(url).toContain('pageSize=20')
    })

    it('throws on error response', async () => {
      vi.mocked(fetch).mockResolvedValueOnce(makeResponse({ error: 'forbidden' }, false, 403))

      await expect(listUsers(1, 10)).rejects.toThrow('forbidden')
    })
  })

  describe('updateUserStatus', () => {
    it('patches user and returns updated user', async () => {
      const updated = { id: 'u1', status: 'active' }
      vi.mocked(fetch).mockResolvedValueOnce(makeResponse(updated))

      const result = await updateUserStatus('u1', 'active')

      expect(result).toEqual(updated)
      const [url, init] = vi.mocked(fetch).mock.calls[0] as [string, RequestInit]
      expect(url).toContain('/api/admin/users/u1')
      expect(init.method).toBe('PATCH')
      const body = typeof init.body === 'string' ? JSON.parse(init.body) : null
      expect(body).toMatchObject({ status: 'active' })
    })

    it('sends disabled status correctly', async () => {
      const updated = { id: 'u1', status: 'disabled' }
      vi.mocked(fetch).mockResolvedValueOnce(makeResponse(updated))

      await updateUserStatus('u1', 'disabled')

      const [, init] = vi.mocked(fetch).mock.calls[0] as [string, RequestInit]
      const body = typeof init.body === 'string' ? JSON.parse(init.body) : null
      expect(body).toMatchObject({ status: 'disabled' })
    })

    it('throws on error response', async () => {
      vi.mocked(fetch).mockResolvedValueOnce(makeResponse({ error: 'not found' }, false, 404))

      await expect(updateUserStatus('missing', 'active')).rejects.toThrow('not found')
    })
  })

  describe('deleteUser', () => {
    it('sends DELETE request and returns deleted flag', async () => {
      const payload = { id: 'u1', deleted: true }
      vi.mocked(fetch).mockResolvedValueOnce(makeResponse(payload))

      const result = await deleteUser('u1')

      expect(result).toEqual(payload)
      const [url, init] = vi.mocked(fetch).mock.calls[0] as [string, RequestInit]
      expect(url).toContain('/api/admin/users/u1')
      expect(init.method).toBe('DELETE')
    })

    it('throws on error response', async () => {
      vi.mocked(fetch).mockResolvedValueOnce(makeResponse({ error: 'forbidden' }, false, 403))

      await expect(deleteUser('u1')).rejects.toThrow('forbidden')
    })
  })

  describe('listQuotas', () => {
    it('fetches quotas list', async () => {
      const payload = { items: [{ orgId: 'org1', quota: 1024, used: 512 }], total: 1 }
      vi.mocked(fetch).mockResolvedValueOnce(makeResponse(payload))

      const result = await listQuotas()

      expect(result).toEqual(payload)
      const [url] = vi.mocked(fetch).mock.calls[0] as [string]
      expect(url).toContain('/api/admin/quotas')
    })

    it('throws on error response', async () => {
      vi.mocked(fetch).mockResolvedValueOnce(makeResponse({ error: 'forbidden' }, false, 403))

      await expect(listQuotas()).rejects.toThrow('forbidden')
    })
  })

  describe('updateQuota', () => {
    it('puts quota for an org and returns updated quota', async () => {
      const updated = { orgId: 'org1', quota: 2048 }
      vi.mocked(fetch).mockResolvedValueOnce(makeResponse(updated))

      const result = await updateQuota('org1', 2048)

      expect(result).toEqual(updated)
      const [url, init] = vi.mocked(fetch).mock.calls[0] as [string, RequestInit]
      expect(url).toContain('/api/admin/quotas/org1')
      expect(init.method).toBe('PUT')
      const body = typeof init.body === 'string' ? JSON.parse(init.body) : null
      expect(body).toMatchObject({ quota: 2048 })
    })

    it('throws on error response', async () => {
      vi.mocked(fetch).mockResolvedValueOnce(makeResponse({ error: 'not found' }, false, 404))

      await expect(updateQuota('missing', 100)).rejects.toThrow('not found')
    })
  })

  describe('getUserQuota', () => {
    it('fetches the current user quota', async () => {
      const payload = { orgId: 'org1', quota: 1024, used: 256 }
      vi.mocked(fetch).mockResolvedValueOnce(makeResponse(payload))

      const result = await getUserQuota()

      expect(result).toEqual(payload)
      const [url] = vi.mocked(fetch).mock.calls[0] as [string]
      expect(url).toContain('/api/quotas/me')
    })

    it('throws on error response', async () => {
      vi.mocked(fetch).mockResolvedValueOnce(makeResponse({ error: 'unauthorized' }, false, 401))

      await expect(getUserQuota()).rejects.toThrow('unauthorized')
    })
  })

  describe('listSystemOptions', () => {
    it('fetches all system options', async () => {
      const payload = { items: [{ key: 'site_name', value: 'ZPan', public: true }], total: 1 }
      vi.mocked(fetch).mockResolvedValueOnce(makeResponse(payload))

      const result = await listSystemOptions()

      expect(result).toEqual(payload)
      const [url] = vi.mocked(fetch).mock.calls[0] as [string]
      expect(url).toContain('/api/system/options')
    })

    it('throws on error response', async () => {
      vi.mocked(fetch).mockResolvedValueOnce(makeResponse({ error: 'forbidden' }, false, 403))

      await expect(listSystemOptions()).rejects.toThrow('forbidden')
    })
  })

  describe('getSystemOption', () => {
    it('fetches a single system option by key', async () => {
      const option = { key: 'site_name', value: 'ZPan', public: true }
      vi.mocked(fetch).mockResolvedValueOnce(makeResponse(option))

      const result = await getSystemOption('site_name')

      expect(result).toEqual(option)
      const [url] = vi.mocked(fetch).mock.calls[0] as [string]
      expect(url).toContain('/api/system/options/site_name')
    })

    it('throws on error response', async () => {
      vi.mocked(fetch).mockResolvedValueOnce(makeResponse({ error: 'not found' }, false, 404))

      await expect(getSystemOption('missing_key')).rejects.toThrow('not found')
    })
  })

  describe('setSystemOption', () => {
    it('puts option with value only when isPublic is not provided', async () => {
      const option = { key: 'site_name', value: 'MyZPan', public: false }
      vi.mocked(fetch).mockResolvedValueOnce(makeResponse(option))

      const result = await setSystemOption('site_name', 'MyZPan')

      expect(result).toEqual(option)
      const [url, init] = vi.mocked(fetch).mock.calls[0] as [string, RequestInit]
      expect(url).toContain('/api/system/options/site_name')
      expect(init.method).toBe('PUT')
      const body = typeof init.body === 'string' ? JSON.parse(init.body) : null
      expect(body).toEqual({ value: 'MyZPan' })
      expect(body.public).toBeUndefined()
    })

    it('puts option with value and public=true when isPublic is true', async () => {
      const option = { key: 'site_name', value: 'MyZPan', public: true }
      vi.mocked(fetch).mockResolvedValueOnce(makeResponse(option))

      await setSystemOption('site_name', 'MyZPan', true)

      const [, init] = vi.mocked(fetch).mock.calls[0] as [string, RequestInit]
      const body = typeof init.body === 'string' ? JSON.parse(init.body) : null
      expect(body).toEqual({ value: 'MyZPan', public: true })
    })

    it('puts option with value and public=false when isPublic is false', async () => {
      const option = { key: 'site_name', value: 'MyZPan', public: false }
      vi.mocked(fetch).mockResolvedValueOnce(makeResponse(option))

      await setSystemOption('site_name', 'MyZPan', false)

      const [, init] = vi.mocked(fetch).mock.calls[0] as [string, RequestInit]
      const body = typeof init.body === 'string' ? JSON.parse(init.body) : null
      expect(body).toEqual({ value: 'MyZPan', public: false })
    })

    it('throws on error response', async () => {
      vi.mocked(fetch).mockResolvedValueOnce(makeResponse({ error: 'forbidden' }, false, 403))

      await expect(setSystemOption('key', 'val')).rejects.toThrow('forbidden')
    })
  })

  describe('getSession', () => {
    it('fetches session from /api/auth/get-session with credentials include', async () => {
      const session = { session: { id: 'sess1' }, user: { id: 'u1', email: 'a@b.com' } }
      vi.mocked(fetch).mockResolvedValueOnce(makeResponse(session))

      const result = await getSession()

      expect(result).toEqual(session)
      const [url, init] = vi.mocked(fetch).mock.calls[0] as [string, RequestInit]
      expect(url).toBe('/api/auth/get-session')
      expect(init.credentials).toBe('include')
    })

    it('returns null when response is not ok', async () => {
      vi.mocked(fetch).mockResolvedValueOnce(makeResponse({ error: 'unauthorized' }, false, 401))

      const result = await getSession()

      expect(result).toBeNull()
    })
  })

  describe('trashObject', () => {
    it('sends PATCH with action: trash for the given id', async () => {
      const obj = { id: 'id1', status: 'trashed' }
      vi.mocked(fetch).mockResolvedValueOnce(makeResponse(obj))

      const result = await trashObject('id1')

      expect(result).toEqual(obj)
      const [url, init] = vi.mocked(fetch).mock.calls[0] as [string, RequestInit]
      expect(url).toContain('/api/objects/id1')
      expect(init.method).toBe('PATCH')
      const body = typeof init.body === 'string' ? JSON.parse(init.body) : null
      expect(body).toMatchObject({ action: 'trash' })
    })

    it('throws on error response', async () => {
      vi.mocked(fetch).mockResolvedValueOnce(makeResponse({ error: 'not found' }, false, 404))

      await expect(trashObject('missing')).rejects.toThrow('not found')
    })
  })

  describe('batchTrashObjects', () => {
    it('patches batch endpoint with action: trash and returns trashed count', async () => {
      const payload = { trashed: 3 }
      vi.mocked(fetch).mockResolvedValueOnce(makeResponse(payload))

      const result = await batchTrashObjects(['id1', 'id2', 'id3'])

      expect(result).toEqual(payload)
      const [url, init] = vi.mocked(fetch).mock.calls[0] as [string, RequestInit]
      expect(url).toContain('/api/objects/batch')
      expect(init.method).toBe('PATCH')
      const body = typeof init.body === 'string' ? JSON.parse(init.body) : null
      expect(body).toMatchObject({ action: 'trash', ids: ['id1', 'id2', 'id3'] })
    })

    it('posts an empty ids array without error', async () => {
      vi.mocked(fetch).mockResolvedValueOnce(makeResponse({ trashed: 0 }))

      const result = await batchTrashObjects([])

      expect(result).toEqual({ trashed: 0 })
      const [, init] = vi.mocked(fetch).mock.calls[0] as [string, RequestInit]
      const body = typeof init.body === 'string' ? JSON.parse(init.body) : null
      expect(body).toMatchObject({ action: 'trash', ids: [] })
    })

    it('throws on error response', async () => {
      vi.mocked(fetch).mockResolvedValueOnce(makeResponse({ error: 'forbidden' }, false, 403))

      await expect(batchTrashObjects(['id1'])).rejects.toThrow('forbidden')
    })
  })

  describe('batchMoveObjects', () => {
    it('patches batch endpoint with action: move and returns moved count', async () => {
      const payload = { moved: 2 }
      vi.mocked(fetch).mockResolvedValueOnce(makeResponse(payload))

      const result = await batchMoveObjects(['id1', 'id2'], 'folder1')

      expect(result).toEqual(payload)
      const [url, init] = vi.mocked(fetch).mock.calls[0] as [string, RequestInit]
      expect(url).toContain('/api/objects/batch')
      expect(init.method).toBe('PATCH')
      const body = typeof init.body === 'string' ? JSON.parse(init.body) : null
      expect(body).toMatchObject({ action: 'move', ids: ['id1', 'id2'], parent: 'folder1' })
    })

    it('throws on error response', async () => {
      vi.mocked(fetch).mockResolvedValueOnce(makeResponse({ error: 'not found' }, false, 404))

      await expect(batchMoveObjects(['id1'], 'missing-folder')).rejects.toThrow('not found')
    })
  })

  describe('batchDeleteObjects', () => {
    it('sends DELETE to batch endpoint and returns deleted count', async () => {
      const payload = { deleted: 2 }
      vi.mocked(fetch).mockResolvedValueOnce(makeResponse(payload))

      const result = await batchDeleteObjects(['id1', 'id2'])

      expect(result).toEqual(payload)
      const [url, init] = vi.mocked(fetch).mock.calls[0] as [string, RequestInit]
      expect(url).toContain('/api/objects/batch')
      expect(init.method).toBe('DELETE')
      const body = typeof init.body === 'string' ? JSON.parse(init.body) : null
      expect(body).toMatchObject({ ids: ['id1', 'id2'] })
    })

    it('posts an empty ids array without error', async () => {
      vi.mocked(fetch).mockResolvedValueOnce(makeResponse({ deleted: 0 }))

      const result = await batchDeleteObjects([])

      expect(result).toEqual({ deleted: 0 })
    })

    it('throws on error response', async () => {
      vi.mocked(fetch).mockResolvedValueOnce(makeResponse({ error: 'server error' }, false, 500))

      await expect(batchDeleteObjects(['id1'])).rejects.toThrow('server error')
    })
  })

  describe('listAuthProviders', () => {
    it('fetches auth providers list from /api/auth-providers', async () => {
      const payload = {
        items: [{ providerId: 'github', type: 'oauth', name: 'GitHub', icon: '' }],
      }
      vi.mocked(fetch).mockResolvedValueOnce(makeResponse(payload))

      const result = await listAuthProviders()

      expect(result).toEqual(payload)
      const [url] = vi.mocked(fetch).mock.calls[0] as [string]
      expect(url).toContain('/api/auth-providers')
    })

    it('returns items array with expected provider shape', async () => {
      const provider = { providerId: 'google', type: 'oauth', name: 'Google', icon: 'google-icon' }
      vi.mocked(fetch).mockResolvedValueOnce(makeResponse({ items: [provider] }))

      const result = await listAuthProviders()

      expect(result.items).toHaveLength(1)
      expect(result.items[0].providerId).toBe('google')
      expect(result.items[0].name).toBe('Google')
      expect(result.items[0].type).toBe('oauth')
      expect(result.items[0].icon).toBe('google-icon')
    })

    it('returns empty items array when no providers are configured', async () => {
      vi.mocked(fetch).mockResolvedValueOnce(makeResponse({ items: [] }))

      const result = await listAuthProviders()

      expect(result.items).toHaveLength(0)
    })

    it('throws on error response', async () => {
      vi.mocked(fetch).mockResolvedValueOnce(makeResponse({ error: 'forbidden' }, false, 403))

      await expect(listAuthProviders()).rejects.toThrow('forbidden')
    })

    it('passes credentials: include', async () => {
      vi.mocked(fetch).mockResolvedValueOnce(makeResponse({ items: [] }))

      await listAuthProviders()

      const [, init] = vi.mocked(fetch).mock.calls[0] as [string, RequestInit]
      expect(init.credentials).toBe('include')
    })
  })

  describe('getProfile', () => {
    it('fetches public profile by username', async () => {
      const payload = {
        user: { username: 'alice', name: 'Alice', image: null },
        shares: [],
      }
      vi.mocked(fetch).mockResolvedValueOnce(makeResponse(payload))

      const result = await getProfile('alice')

      expect(result).toEqual(payload)
      const [url] = vi.mocked(fetch).mock.calls[0] as [string]
      expect(url).toContain('/api/profiles/alice')
    })

    it('returns shares with download URLs', async () => {
      const matter = { id: 'm1', name: 'photo.jpg', dirtype: 0, downloadUrl: 'https://s3/photo.jpg' }
      const payload = {
        user: { username: 'bob', name: 'Bob', image: null },
        shares: [matter],
      }
      vi.mocked(fetch).mockResolvedValueOnce(makeResponse(payload))

      const result = await getProfile('bob')

      expect(result.shares).toHaveLength(1)
      expect(result.shares[0].downloadUrl).toBe('https://s3/photo.jpg')
    })

    it('throws on 404 response', async () => {
      vi.mocked(fetch).mockResolvedValueOnce(makeResponse({ error: 'User not found' }, false, 404))

      await expect(getProfile('nobody')).rejects.toThrow('User not found')
    })
  })

  describe('listNotifications', () => {
    it('calls /api/notifications with default params', async () => {
      const payload = { items: [], total: 0, unreadCount: 0, page: 1, pageSize: 20 }
      vi.mocked(fetch).mockResolvedValueOnce(makeResponse(payload))

      const result = await listNotifications()

      expect(result).toEqual(payload)
      const [url] = vi.mocked(fetch).mock.calls[0] as [string]
      expect(url).toContain('/api/notifications')
      expect(url).toContain('page=1')
      expect(url).toContain('pageSize=20')
      expect(url).toContain('unread=false')
    })

    it('passes page, pageSize, and unreadOnly params', async () => {
      const payload = { items: [], total: 5, unreadCount: 5, page: 2, pageSize: 10 }
      vi.mocked(fetch).mockResolvedValueOnce(makeResponse(payload))

      await listNotifications(2, 10, true)

      const [url] = vi.mocked(fetch).mock.calls[0] as [string]
      expect(url).toContain('page=2')
      expect(url).toContain('pageSize=10')
      expect(url).toContain('unread=true')
    })

    it('throws on error response', async () => {
      vi.mocked(fetch).mockResolvedValueOnce(makeResponse({ error: 'unauthorized' }, false, 401))

      await expect(listNotifications()).rejects.toThrow('unauthorized')
    })
  })

  describe('getUnreadCount', () => {
    it('calls /api/notifications/stats and returns count', async () => {
      vi.mocked(fetch).mockResolvedValueOnce(makeResponse({ count: 3 }))

      const result = await getUnreadCount()

      expect(result).toEqual({ count: 3 })
      const [url] = vi.mocked(fetch).mock.calls[0] as [string]
      expect(url).toContain('/api/notifications/stats')
    })

    it('throws on error response', async () => {
      vi.mocked(fetch).mockResolvedValueOnce(makeResponse({ error: 'unauthorized' }, false, 401))

      await expect(getUnreadCount()).rejects.toThrow('unauthorized')
    })
  })

  describe('markNotificationRead', () => {
    it('patches /api/notifications/:id and resolves on 204', async () => {
      vi.mocked(fetch).mockResolvedValueOnce({ ok: true, status: 204 } as Response)

      await expect(markNotificationRead('notif-1')).resolves.toBeUndefined()
      const [url, init] = vi.mocked(fetch).mock.calls[0] as [string, RequestInit]
      expect(url).toContain('/api/notifications/notif-1')
      expect(init.method).toBe('PATCH')
    })

    it('throws ApiError on non-ok response', async () => {
      vi.mocked(fetch).mockResolvedValueOnce({ ok: false, status: 404, statusText: 'Not Found' } as Response)

      await expect(markNotificationRead('missing')).rejects.toThrow('Not Found')
    })
  })

  describe('markAllNotificationsRead', () => {
    it('patches /api/notifications and returns count', async () => {
      vi.mocked(fetch).mockResolvedValueOnce(makeResponse({ count: 5 }))

      const result = await markAllNotificationsRead()

      expect(result).toEqual({ count: 5 })
      const [url, init] = vi.mocked(fetch).mock.calls[0] as [string, RequestInit]
      expect(url).toContain('/api/notifications')
      expect(init.method).toBe('PATCH')
    })

    it('throws on error response', async () => {
      vi.mocked(fetch).mockResolvedValueOnce(makeResponse({ error: 'unauthorized' }, false, 401))

      await expect(markAllNotificationsRead()).rejects.toThrow('unauthorized')
    })
  })

  describe('listShares', () => {
    it('calls /api/shares with default params', async () => {
      const payload = { items: [], total: 0, page: 1, pageSize: 20 }
      vi.mocked(fetch).mockResolvedValueOnce(makeResponse(payload))

      const result = await listShares()

      expect(result).toEqual(payload)
      const [url] = vi.mocked(fetch).mock.calls[0] as [string]
      expect(url).toContain('/api/shares')
      expect(url).toContain('page=1')
      expect(url).toContain('pageSize=20')
    })

    it('passes page, pageSize, and status params', async () => {
      const payload = { items: [], total: 3, page: 2, pageSize: 10 }
      vi.mocked(fetch).mockResolvedValueOnce(makeResponse(payload))

      await listShares(2, 10, 'active')

      const [url] = vi.mocked(fetch).mock.calls[0] as [string]
      expect(url).toContain('page=2')
      expect(url).toContain('pageSize=10')
      expect(url).toContain('status=active')
    })

    it('throws on error response', async () => {
      vi.mocked(fetch).mockResolvedValueOnce(makeResponse({ error: 'unauthorized' }, false, 401))

      await expect(listShares()).rejects.toThrow('unauthorized')
    })
  })

  describe('getShare', () => {
    it('calls GET /api/shares/:token and returns share view', async () => {
      const payload = {
        token: 'tok123',
        kind: 'landing',
        status: 'active',
        expiresAt: null,
        downloadLimit: null,
        matter: { name: 'photo.jpg', type: 'image/jpeg', size: 1024, isFolder: false },
        creatorName: 'Alice',
        requiresPassword: false,
        expired: false,
        exhausted: false,
        accessibleByUser: false,
        downloads: 0,
        views: 1,
        rootRef: 'abc',
      }
      vi.mocked(fetch).mockResolvedValueOnce(makeResponse(payload))

      const result = await getShare('tok123')

      expect(result).toEqual(payload)
      const [url] = vi.mocked(fetch).mock.calls[0] as [string]
      expect(url).toContain('/api/shares/tok123')
    })

    it('throws on 404', async () => {
      vi.mocked(fetch).mockResolvedValueOnce(makeResponse({ error: 'Share not found or revoked' }, false, 404))

      await expect(getShare('bad-token')).rejects.toThrow('Share not found or revoked')
    })

    it('throws on 410 (matter trashed)', async () => {
      vi.mocked(fetch).mockResolvedValueOnce(makeResponse({ error: 'File no longer available' }, false, 410))

      await expect(getShare('bad-token')).rejects.toThrow('File no longer available')
    })
  })

  describe('deleteShare', () => {
    it('calls DELETE /api/shares/:token and resolves on 204', async () => {
      vi.mocked(fetch).mockResolvedValueOnce({ ok: true, status: 204 } as Response)

      await expect(deleteShare('tok123')).resolves.toBeUndefined()
      const [url, init] = vi.mocked(fetch).mock.calls[0] as [string, RequestInit]
      expect(url).toContain('/api/shares/tok123')
      expect(init.method).toBe('DELETE')
    })

    it('throws ApiError on non-ok response', async () => {
      vi.mocked(fetch).mockResolvedValueOnce({ ok: false, status: 403, statusText: 'Forbidden' } as Response)

      await expect(deleteShare('tok123')).rejects.toThrow('Forbidden')
    })
  })

  describe('createShare', () => {
    it('posts share data to /api/shares and returns created share result', async () => {
      const payload = {
        token: 'tok123',
        kind: 'landing' as const,
        urls: { landing: 'https://zpan.io/s/tok123' },
        expiresAt: null,
        downloadLimit: null,
      }
      vi.mocked(fetch).mockResolvedValueOnce(makeResponse(payload))

      const result = await createShare({ matterId: 'obj-1', kind: 'landing' })

      expect(result).toEqual(payload)
      const [url, init] = vi.mocked(fetch).mock.calls[0] as [string, RequestInit]
      expect(url).toContain('/api/shares')
      expect(init.method).toBe('POST')
      const body = typeof init.body === 'string' ? JSON.parse(init.body) : null
      expect(body).toMatchObject({ matterId: 'obj-1', kind: 'landing' })
      const headers =
        init.headers instanceof Headers ? init.headers : new Headers(init.headers as Record<string, string>)
      expect(headers.get('Content-Type')).toContain('application/json')
    })

    it('throws on error response', async () => {
      vi.mocked(fetch).mockResolvedValueOnce(makeResponse({ error: 'unauthorized' }, false, 401))

      await expect(createShare({ matterId: 'obj-1', kind: 'landing' })).rejects.toThrow('unauthorized')
    })
  })

  describe('verifySharePassword', () => {
    it('calls POST /api/shares/:token/sessions with password', async () => {
      vi.mocked(fetch).mockResolvedValueOnce(makeResponse({ ok: true }))

      const result = await verifySharePassword('tok123', 'secret')

      expect(result).toEqual({ ok: true })
      const [url, init] = vi.mocked(fetch).mock.calls[0] as [string, RequestInit]
      expect(url).toContain('/api/shares/tok123/sessions')
      expect(init.method).toBe('POST')
      expect(JSON.parse(init.body as string)).toEqual({ password: 'secret' })
    })

    it('throws ApiError on 403 (wrong password)', async () => {
      vi.mocked(fetch).mockResolvedValueOnce(makeResponse({ error: 'Invalid password' }, false, 403))

      await expect(verifySharePassword('tok123', 'wrong')).rejects.toThrow('Invalid password')
    })
  })

  describe('listShareObjects', () => {
    it('calls GET /api/shares/:token/objects with default params', async () => {
      const payload = { items: [], total: 0, page: 1, pageSize: 50, breadcrumb: [] }
      vi.mocked(fetch).mockResolvedValueOnce(makeResponse(payload))

      const result = await listShareObjects('tok123')

      expect(result).toEqual(payload)
      const [url] = vi.mocked(fetch).mock.calls[0] as [string]
      expect(url).toContain('/api/shares/tok123/objects')
      expect(url).toContain('page=1')
      expect(url).toContain('pageSize=50')
    })

    it('passes custom parent, page, and pageSize', async () => {
      vi.mocked(fetch).mockResolvedValueOnce(
        makeResponse({ items: [], total: 0, page: 2, pageSize: 10, breadcrumb: [] }),
      )

      await listShareObjects('tok123', 'Reports', 2, 10)

      const [url] = vi.mocked(fetch).mock.calls[0] as [string]
      expect(url).toContain('parent=Reports')
      expect(url).toContain('page=2')
      expect(url).toContain('pageSize=10')
    })

    it('throws ApiError on 401 (password required)', async () => {
      vi.mocked(fetch).mockResolvedValueOnce(makeResponse({ error: 'Password required' }, false, 401))

      await expect(listShareObjects('tok123')).rejects.toThrow('Password required')
    })
  })

  describe('buildShareObjectUrl', () => {
    it('returns the canonical share object download URL', () => {
      expect(buildShareObjectUrl('tok123', 'refABC')).toBe('/api/shares/tok123/objects/refABC')
    })
  })

  describe('saveShareToDrive', () => {
    it('calls POST /api/shares/:token/objects with targetOrgId and targetParent', async () => {
      const payload = { saved: [{ id: 'obj-1', name: 'photo.jpg' }], skipped: [] }
      vi.mocked(fetch).mockResolvedValueOnce(makeResponse(payload, true, 201))

      const result = await saveShareToDrive('tok123', { targetOrgId: 'org-1', targetParent: 'Docs' })

      expect(result).toEqual(payload)
      const [url, init] = vi.mocked(fetch).mock.calls[0] as [string, RequestInit]
      expect(url).toContain('/api/shares/tok123/objects')
      expect(init.method).toBe('POST')
      expect(JSON.parse(init.body as string)).toEqual({ targetOrgId: 'org-1', targetParent: 'Docs' })
    })

    it('throws ApiError with QUOTA_EXCEEDED code on 400', async () => {
      vi.mocked(fetch).mockResolvedValueOnce(
        makeResponse({ error: 'Quota exceeded', code: 'QUOTA_EXCEEDED' }, false, 400),
      )

      await expect(saveShareToDrive('tok123', { targetOrgId: 'org-1', targetParent: '' })).rejects.toThrow(
        'Quota exceeded',
      )
    })

    it('throws ApiError on 401 (password required)', async () => {
      vi.mocked(fetch).mockResolvedValueOnce(
        makeResponse({ error: 'Authentication required for password-protected share' }, false, 401),
      )

      await expect(saveShareToDrive('tok123', { targetOrgId: 'org-1', targetParent: '' })).rejects.toThrow(
        'Authentication required',
      )
    })

    it('throws ApiError on 410 (share gone)', async () => {
      vi.mocked(fetch).mockResolvedValueOnce(makeResponse({ error: 'Share target has been deleted' }, false, 410))

      await expect(saveShareToDrive('tok123', { targetOrgId: 'org-1', targetParent: '' })).rejects.toThrow(
        'Share target has been deleted',
      )
    })
  })

  describe('getIhostConfig', () => {
    it('calls GET /api/ihost/config and returns config when enabled', async () => {
      const payload = {
        enabled: true,
        customDomain: null,
        domainVerifiedAt: null,
        domainStatus: 'none',
        dnsInstructions: null,
        refererAllowlist: null,
        createdAt: 1700000000000,
      }
      vi.mocked(fetch).mockResolvedValueOnce(makeResponse(payload))

      const result = await getIhostConfig()

      expect(result).toEqual(payload)
      const [url] = vi.mocked(fetch).mock.calls[0] as [string]
      expect(url).toContain('/api/ihost/config')
    })

    it('returns null when feature is not enabled', async () => {
      vi.mocked(fetch).mockResolvedValueOnce(makeResponse(null))

      const result = await getIhostConfig()

      expect(result).toBeNull()
    })

    it('passes credentials: include', async () => {
      vi.mocked(fetch).mockResolvedValueOnce(makeResponse(null))

      await getIhostConfig()

      const [, init] = vi.mocked(fetch).mock.calls[0] as [string, RequestInit]
      expect(init.credentials).toBe('include')
    })

    it('throws ApiError on 401', async () => {
      vi.mocked(fetch).mockResolvedValueOnce(makeResponse({ error: 'Unauthorized' }, false, 401))

      await expect(getIhostConfig()).rejects.toThrow('Unauthorized')
    })
  })

  describe('enableIhostFeature', () => {
    it('calls PUT /api/ihost/config with enabled: true and returns config', async () => {
      const payload = {
        enabled: true,
        customDomain: null,
        domainVerifiedAt: null,
        domainStatus: 'none',
        dnsInstructions: null,
        refererAllowlist: null,
        createdAt: 1700000000000,
      }
      vi.mocked(fetch).mockResolvedValueOnce(makeResponse(payload, true, 200))

      const result = await enableIhostFeature()

      expect(result).toEqual(payload)
      const [url, init] = vi.mocked(fetch).mock.calls[0] as [string, RequestInit]
      expect(url).toContain('/api/ihost/config')
      expect(init.method).toBe('PUT')
      expect(JSON.parse(init.body as string)).toEqual({ enabled: true })
    })

    it('passes credentials: include', async () => {
      vi.mocked(fetch).mockResolvedValueOnce(
        makeResponse({
          enabled: true,
          customDomain: null,
          domainVerifiedAt: null,
          domainStatus: 'none',
          dnsInstructions: null,
          refererAllowlist: null,
          createdAt: 1700000000000,
        }),
      )

      await enableIhostFeature()

      const [, init] = vi.mocked(fetch).mock.calls[0] as [string, RequestInit]
      expect(init.credentials).toBe('include')
    })

    it('throws ApiError on 403 (insufficient role)', async () => {
      vi.mocked(fetch).mockResolvedValueOnce(makeResponse({ error: 'Forbidden' }, false, 403))

      await expect(enableIhostFeature()).rejects.toThrow('Forbidden')
    })

    it('throws ApiError on 409 (domain already in use)', async () => {
      vi.mocked(fetch).mockResolvedValueOnce(makeResponse({ error: 'Domain already in use' }, false, 409))

      await expect(enableIhostFeature()).rejects.toThrow('Domain already in use')
    })
  })

  describe('updateIhostConfig', () => {
    const baseConfig = {
      enabled: true,
      customDomain: null,
      domainVerifiedAt: null,
      domainStatus: 'none',
      dnsInstructions: null,
      refererAllowlist: null,
      createdAt: 1700000000000,
    }

    it('sends PUT with enabled:true and customDomain', async () => {
      vi.mocked(fetch).mockResolvedValueOnce(makeResponse(baseConfig))

      await updateIhostConfig({ customDomain: 'img.example.com' })

      const [url, init] = vi.mocked(fetch).mock.calls[0] as [string, RequestInit]
      expect(url).toContain('/api/ihost/config')
      expect(init.method).toBe('PUT')
      const body = JSON.parse(init.body as string)
      expect(body.enabled).toBe(true)
      expect(body.customDomain).toBe('img.example.com')
    })

    it('sends PUT with refererAllowlist', async () => {
      vi.mocked(fetch).mockResolvedValueOnce(makeResponse(baseConfig))

      await updateIhostConfig({ refererAllowlist: ['https://example.com'] })

      const [, init] = vi.mocked(fetch).mock.calls[0] as [string, RequestInit]
      const body = JSON.parse(init.body as string)
      expect(body.refererAllowlist).toEqual(['https://example.com'])
    })

    it('resolves with updated config on success', async () => {
      vi.mocked(fetch).mockResolvedValueOnce(makeResponse(baseConfig))

      const result = await updateIhostConfig({})

      expect(result).toEqual(baseConfig)
    })

    it('throws ApiError on failure', async () => {
      vi.mocked(fetch).mockResolvedValueOnce(makeResponse({ error: 'Forbidden' }, false, 403))

      await expect(updateIhostConfig({})).rejects.toThrow('Forbidden')
    })
  })

  describe('deleteIhostConfig', () => {
    it('sends DELETE to /api/ihost/config', async () => {
      vi.mocked(fetch).mockResolvedValueOnce(makeResponse(null, true, 204))

      await deleteIhostConfig()

      const [url, init] = vi.mocked(fetch).mock.calls[0] as [string, RequestInit]
      expect(url).toContain('/api/ihost/config')
      expect(init.method).toBe('DELETE')
    })

    it('resolves without error on 204', async () => {
      vi.mocked(fetch).mockResolvedValueOnce(makeResponse(null, true, 204))

      await expect(deleteIhostConfig()).resolves.toBeUndefined()
    })

    it('throws ApiError on non-ok response', async () => {
      vi.mocked(fetch).mockResolvedValueOnce(makeResponse({ error: 'Forbidden' }, false, 403))

      await expect(deleteIhostConfig()).rejects.toBeInstanceOf(Error)
    })
  })

  describe('listIhostApiKeys', () => {
    const sampleKey = {
      id: 'key-1',
      name: 'My Key',
      start: 'abc',
      prefix: null,
      createdAt: '2024-01-01T00:00:00.000Z',
      lastRequest: null,
      permissions: { 'image-hosting': ['upload'] },
      referenceId: 'org-1',
      enabled: true,
    }

    it('calls GET /api/auth/api-key/list with organizationId', async () => {
      vi.mocked(fetch).mockResolvedValueOnce(makeResponse({ apiKeys: [sampleKey] }))

      await listIhostApiKeys('org-1')

      const [url] = vi.mocked(fetch).mock.calls[0] as [string, RequestInit]
      expect(url).toContain('/api/auth/api-key/list')
      expect(url).toContain('organizationId=org-1')
    })

    it('filters to image-hosting:upload permission only', async () => {
      const otherKey = {
        ...sampleKey,
        id: 'key-2',
        permissions: { 'other-scope': ['read'] },
      }
      vi.mocked(fetch).mockResolvedValueOnce(makeResponse({ apiKeys: [sampleKey, otherKey] }))

      const result = await listIhostApiKeys('org-1')

      expect(result).toHaveLength(1)
      expect(result[0].id).toBe('key-1')
    })

    it('returns empty array when no matching keys', async () => {
      vi.mocked(fetch).mockResolvedValueOnce(makeResponse({ apiKeys: [] }))

      const result = await listIhostApiKeys('org-1')

      expect(result).toEqual([])
    })

    it('throws ApiError on failure', async () => {
      vi.mocked(fetch).mockResolvedValueOnce(makeResponse({ error: 'Unauthorized' }, false, 401))

      await expect(listIhostApiKeys('org-1')).rejects.toThrow('Unauthorized')
    })
  })

  describe('createIhostApiKey', () => {
    const createdKey = {
      id: 'new-key',
      key: 'sk_live_abc123xyz',
      name: 'Test Key',
      start: 'sk_',
      prefix: null,
      createdAt: '2024-01-01T00:00:00.000Z',
      lastRequest: null,
      permissions: { 'image-hosting': ['upload'] },
      referenceId: 'org-1',
      enabled: true,
    }

    it('calls POST /api/auth/api-key/create', async () => {
      vi.mocked(fetch).mockResolvedValueOnce(makeResponse(createdKey))

      await createIhostApiKey('org-1', 'Test Key')

      const [url, init] = vi.mocked(fetch).mock.calls[0] as [string, RequestInit]
      expect(url).toContain('/api/auth/api-key/create')
      expect(init.method).toBe('POST')
    })

    it('sends organizationId and name (permissions set by server defaults)', async () => {
      vi.mocked(fetch).mockResolvedValueOnce(makeResponse(createdKey))

      await createIhostApiKey('org-1', 'Test Key')

      const [, init] = vi.mocked(fetch).mock.calls[0] as [string, RequestInit]
      const body = JSON.parse(init.body as string)
      expect(body.organizationId).toBe('org-1')
      expect(body.name).toBe('Test Key')
      expect(body.permissions).toBeUndefined()
    })

    it('resolves with the full key on success', async () => {
      vi.mocked(fetch).mockResolvedValueOnce(makeResponse(createdKey))

      const result = await createIhostApiKey('org-1', 'Test Key')

      expect(result.key).toBe('sk_live_abc123xyz')
      expect(result.id).toBe('new-key')
    })

    it('throws ApiError on failure', async () => {
      vi.mocked(fetch).mockResolvedValueOnce(makeResponse({ error: 'Name required' }, false, 400))

      await expect(createIhostApiKey('org-1', '')).rejects.toThrow('Name required')
    })
  })

  describe('revokeIhostApiKey', () => {
    it('calls POST /api/auth/api-key/delete', async () => {
      vi.mocked(fetch).mockResolvedValueOnce(makeResponse({ success: true }))

      await revokeIhostApiKey('key-1')

      const [url, init] = vi.mocked(fetch).mock.calls[0] as [string, RequestInit]
      expect(url).toContain('/api/auth/api-key/delete')
      expect(init.method).toBe('POST')
    })

    it('sends keyId in request body', async () => {
      vi.mocked(fetch).mockResolvedValueOnce(makeResponse({ success: true }))

      await revokeIhostApiKey('key-1')

      const [, init] = vi.mocked(fetch).mock.calls[0] as [string, RequestInit]
      const body = JSON.parse(init.body as string)
      expect(body.keyId).toBe('key-1')
    })

    it('resolves with success response', async () => {
      vi.mocked(fetch).mockResolvedValueOnce(makeResponse({ success: true }))

      const result = await revokeIhostApiKey('key-1')

      expect(result).toEqual({ success: true })
    })

    it('throws ApiError on failure', async () => {
      vi.mocked(fetch).mockResolvedValueOnce(makeResponse({ error: 'Key not found' }, false, 404))

      await expect(revokeIhostApiKey('key-1')).rejects.toThrow('Key not found')
    })
  })

  describe('listIhostImages', () => {
    it('calls GET /api/ihost/images', async () => {
      vi.mocked(fetch).mockResolvedValueOnce(makeResponse({ items: [], nextCursor: null }))

      await listIhostImages()

      const [url] = vi.mocked(fetch).mock.calls[0] as [string, RequestInit]
      expect(url).toContain('/api/ihost/images')
    })

    it('passes pathPrefix, cursor, and limit as query params', async () => {
      vi.mocked(fetch).mockResolvedValueOnce(makeResponse({ items: [], nextCursor: null }))

      await listIhostImages({ pathPrefix: 'foo/', cursor: 'abc', limit: 20 })

      const [url] = vi.mocked(fetch).mock.calls[0] as [string, RequestInit]
      expect(url).toContain('pathPrefix=foo%2F')
      expect(url).toContain('cursor=abc')
      expect(url).toContain('limit=20')
    })

    it('resolves with items and nextCursor', async () => {
      const payload = { items: [{ id: 'img-1' }], nextCursor: 'next' }
      vi.mocked(fetch).mockResolvedValueOnce(makeResponse(payload))

      const result = await listIhostImages()

      expect(result).toEqual(payload)
    })

    it('throws ApiError on failure', async () => {
      vi.mocked(fetch).mockResolvedValueOnce(makeResponse({ error: 'Forbidden' }, false, 403))

      await expect(listIhostImages()).rejects.toThrow('Forbidden')
    })
  })

  describe('createIhostImagePresign', () => {
    it('calls POST /api/ihost/images/presign with JSON body', async () => {
      const draft = {
        id: 'd1',
        token: 'ih_abc',
        path: 'foo/bar.png',
        uploadUrl: 'https://s3/...',
        storageKey: 'ih/...',
      }
      vi.mocked(fetch).mockResolvedValueOnce(makeResponse(draft, true, 201))

      await createIhostImagePresign({ path: 'foo/bar.png', mime: 'image/png', size: 1024 })

      const [url, init] = vi.mocked(fetch).mock.calls[0] as [string, RequestInit]
      expect(url).toContain('/api/ihost/images/presign')
      expect(init.method).toBe('POST')
      const body = typeof init.body === 'string' ? JSON.parse(init.body) : null
      expect(body?.path).toBe('foo/bar.png')
      expect(body?.mime).toBe('image/png')
      expect(body?.size).toBe(1024)
    })

    it('resolves with draft object', async () => {
      const draft = {
        id: 'd1',
        token: 'ih_abc',
        path: 'foo/bar.png',
        uploadUrl: 'https://s3/...',
        storageKey: 'ih/...',
      }
      vi.mocked(fetch).mockResolvedValueOnce(makeResponse(draft, true, 201))

      const result = await createIhostImagePresign({ path: 'foo/bar.png', mime: 'image/png', size: 1024 })

      expect(result).toEqual(draft)
    })

    it('throws ApiError on failure', async () => {
      vi.mocked(fetch).mockResolvedValueOnce(makeResponse({ error: 'Quota exceeded' }, false, 422))

      await expect(createIhostImagePresign({ path: 'a.png', mime: 'image/png', size: 100 })).rejects.toThrow(
        'Quota exceeded',
      )
    })
  })

  describe('confirmIhostImage', () => {
    it('calls PATCH /api/ihost/images/:id with action confirm', async () => {
      const image = { id: 'img-1', status: 'active' }
      vi.mocked(fetch).mockResolvedValueOnce(makeResponse(image))

      await confirmIhostImage('img-1')

      const [url, init] = vi.mocked(fetch).mock.calls[0] as [string, RequestInit]
      expect(url).toContain('/api/ihost/images/img-1')
      expect(init.method).toBe('PATCH')
      const body = typeof init.body === 'string' ? JSON.parse(init.body) : null
      expect(body?.action).toBe('confirm')
    })

    it('resolves with confirmed image', async () => {
      const image = { id: 'img-1', status: 'active', token: 'ih_x' }
      vi.mocked(fetch).mockResolvedValueOnce(makeResponse(image))

      const result = await confirmIhostImage('img-1')

      expect(result).toEqual(image)
    })

    it('throws ApiError on failure', async () => {
      vi.mocked(fetch).mockResolvedValueOnce(makeResponse({ error: 'Not found' }, false, 404))

      await expect(confirmIhostImage('bad-id')).rejects.toThrow('Not found')
    })
  })

  describe('deleteIhostImage', () => {
    it('calls DELETE /api/ihost/images/:id', async () => {
      vi.mocked(fetch).mockResolvedValueOnce({ ok: true, status: 204, json: async () => null } as unknown as Response)

      await deleteIhostImage('img-1')

      const [url, init] = vi.mocked(fetch).mock.calls[0] as [string, RequestInit]
      expect(url).toContain('/api/ihost/images/img-1')
      expect(init.method).toBe('DELETE')
    })

    it('throws ApiError on failure', async () => {
      vi.mocked(fetch).mockResolvedValueOnce(makeResponse({ error: 'Not found' }, false, 404))

      await expect(deleteIhostImage('bad-id')).rejects.toThrow()
    })
  })

  describe('uploadAvatar', () => {
    it('PUTs multipart/form-data to /api/me/avatar with file field', async () => {
      vi.mocked(fetch).mockResolvedValueOnce(makeResponse({ url: 'https://example.com/a.png' }, true, 200))
      const file = new File(['x'], 'a.png', { type: 'image/png' })

      await uploadAvatar(file)

      const [url, init] = vi.mocked(fetch).mock.calls[0] as [string, RequestInit]
      expect(url).toBe('/api/me/avatar')
      expect(init.method).toBe('PUT')
      expect(init.body).toBeInstanceOf(FormData)
      expect((init.body as FormData).get('file')).toBe(file)
    })

    it('resolves with the new URL', async () => {
      const payload = { url: 'https://example.com/a.png' }
      vi.mocked(fetch).mockResolvedValueOnce(makeResponse(payload, true, 200))
      const file = new File(['x'], 'a.png', { type: 'image/png' })

      const result = await uploadAvatar(file)
      expect(result).toEqual(payload)
    })

    it('throws ApiError on failure', async () => {
      vi.mocked(fetch).mockResolvedValueOnce(makeResponse({ error: 'File too large' }, false, 413))
      const file = new File(['x'], 'a.png', { type: 'image/png' })

      await expect(uploadAvatar(file)).rejects.toThrow('File too large')
    })
  })

  describe('deleteAvatar', () => {
    it('DELETEs /api/me/avatar', async () => {
      vi.mocked(fetch).mockResolvedValueOnce(makeResponse({ ok: true }, true, 200))
      await deleteAvatar()

      const [url, init] = vi.mocked(fetch).mock.calls[0] as [string, RequestInit]
      expect(url).toContain('/api/me/avatar')
      expect(init.method).toBe('DELETE')
    })

    it('throws ApiError on failure', async () => {
      vi.mocked(fetch).mockResolvedValueOnce(makeResponse({ error: 'Unauthorized' }, false, 401))
      await expect(deleteAvatar()).rejects.toThrow()
    })
  })

  describe('uploadTeamLogo', () => {
    it('PUTs multipart to /api/teams/:id/logo with file field', async () => {
      vi.mocked(fetch).mockResolvedValueOnce(makeResponse({ url: 'https://example.com/l.jpg' }, true, 200))
      const file = new File(['x'], 'l.jpg', { type: 'image/jpeg' })

      await uploadTeamLogo('org-1', file)

      const [url, init] = vi.mocked(fetch).mock.calls[0] as [string, RequestInit]
      expect(url).toBe('/api/teams/org-1/logo')
      expect(init.method).toBe('PUT')
      expect((init.body as FormData).get('file')).toBe(file)
    })

    it('URL-encodes the teamId', async () => {
      vi.mocked(fetch).mockResolvedValueOnce(makeResponse({ url: 'x' }, true, 200))
      const file = new File(['x'], 'l.png', { type: 'image/png' })

      await uploadTeamLogo('org with/special', file)

      const [url] = vi.mocked(fetch).mock.calls[0] as [string, RequestInit]
      expect(url).toBe('/api/teams/org%20with%2Fspecial/logo')
    })

    it('throws ApiError on 403', async () => {
      vi.mocked(fetch).mockResolvedValueOnce(makeResponse({ error: 'Forbidden' }, false, 403))
      const file = new File(['x'], 'l.png', { type: 'image/png' })

      await expect(uploadTeamLogo('org-1', file)).rejects.toThrow('Forbidden')
    })
  })

  describe('deleteTeamLogo', () => {
    it('DELETEs /api/teams/:id/logo', async () => {
      vi.mocked(fetch).mockResolvedValueOnce(makeResponse({ ok: true }, true, 200))
      await deleteTeamLogo('org-1')

      const [url, init] = vi.mocked(fetch).mock.calls[0] as [string, RequestInit]
      expect(url).toContain('/api/teams/org-1/logo')
      expect(init.method).toBe('DELETE')
    })

    it('throws ApiError on failure', async () => {
      vi.mocked(fetch).mockResolvedValueOnce(makeResponse({ error: 'Forbidden' }, false, 403))
      await expect(deleteTeamLogo('org-1')).rejects.toThrow()
    })
  })

  describe('getLicensingStatus', () => {
    it('calls the correct endpoint', async () => {
      vi.mocked(fetch).mockResolvedValueOnce(makeResponse({ bound: false }))

      await getLicensingStatus()

      const [url] = vi.mocked(fetch).mock.calls[0] as [string, RequestInit]
      expect(url).toContain('/api/licensing/status')
    })

    it('returns unbound state', async () => {
      vi.mocked(fetch).mockResolvedValueOnce(makeResponse({ bound: false }))

      const result = await getLicensingStatus()

      expect(result).toEqual({ bound: false })
    })

    it('returns full bound state', async () => {
      const state = {
        bound: true,
        account_email: 'user@example.com',
        plan: 'pro',
        features: ['white_label'],
        expires_at: 9999999999,
        last_refresh_at: 1000000000,
      }
      vi.mocked(fetch).mockResolvedValueOnce(makeResponse(state))

      const result = await getLicensingStatus()

      expect(result).toEqual(state)
    })

    it('throws ApiError on failure', async () => {
      vi.mocked(fetch).mockResolvedValueOnce(makeResponse({ error: 'Internal Server Error' }, false, 500))

      await expect(getLicensingStatus()).rejects.toThrow()
    })
  })

  describe('connectCloud', () => {
    it('calls the correct endpoint with POST', async () => {
      const payload = {
        code: 'ABC-123',
        pairing_url: 'https://cloud.zpan.space/pair',
        expires_at: '2026-01-01T00:00:00Z',
      }
      vi.mocked(fetch).mockResolvedValueOnce(makeResponse(payload))

      await connectCloud()

      const [url, init] = vi.mocked(fetch).mock.calls[0] as [string, RequestInit]
      expect(url).toContain('/api/licensing/pair')
      expect(init.method).toBe('POST')
    })

    it('returns pairing info', async () => {
      const payload = {
        code: 'XYZ-789',
        pairing_url: 'https://cloud.zpan.space/pair',
        expires_at: '2026-01-01T00:00:00Z',
      }
      vi.mocked(fetch).mockResolvedValueOnce(makeResponse(payload))

      const result = await connectCloud()

      expect(result).toEqual(payload)
    })

    it('throws ApiError on non-admin', async () => {
      vi.mocked(fetch).mockResolvedValueOnce(makeResponse({ error: 'Forbidden' }, false, 403))

      await expect(connectCloud()).rejects.toThrow()
    })
  })

  describe('pollPairing', () => {
    it('calls the correct endpoint with code', async () => {
      vi.mocked(fetch).mockResolvedValueOnce(makeResponse({ status: 'pending' }))

      await pollPairing('ABC-123')

      const [url] = vi.mocked(fetch).mock.calls[0] as [string, RequestInit]
      expect(url).toContain('/api/licensing/pair/ABC-123/poll')
    })

    it('returns pending status', async () => {
      vi.mocked(fetch).mockResolvedValueOnce(makeResponse({ status: 'pending' }))

      const result = await pollPairing('CODE-1')

      expect(result.status).toBe('pending')
    })

    it('returns approved status with plan', async () => {
      vi.mocked(fetch).mockResolvedValueOnce(makeResponse({ status: 'approved', plan: 'pro' }))

      const result = await pollPairing('CODE-2')

      expect(result.status).toBe('approved')
      expect(result.plan).toBe('pro')
    })

    it('throws ApiError on error response', async () => {
      vi.mocked(fetch).mockResolvedValueOnce(makeResponse({ error: 'Not Found' }, false, 404))

      await expect(pollPairing('BAD-CODE')).rejects.toThrow()
    })
  })

  describe('refreshLicense', () => {
    it('calls the correct endpoint with POST', async () => {
      vi.mocked(fetch).mockResolvedValueOnce(makeResponse({ success: true, last_refresh_at: 1000000000 }))

      await refreshLicense()

      const [url, init] = vi.mocked(fetch).mock.calls[0] as [string, RequestInit]
      expect(url).toContain('/api/licensing/refresh')
      expect(init.method).toBe('POST')
    })

    it('returns success with last_refresh_at', async () => {
      vi.mocked(fetch).mockResolvedValueOnce(makeResponse({ success: true, last_refresh_at: 1745000000 }))

      const result = await refreshLicense()

      expect(result.success).toBe(true)
      expect(result.last_refresh_at).toBe(1745000000)
    })

    it('throws ApiError on failure', async () => {
      vi.mocked(fetch).mockResolvedValueOnce(makeResponse({ error: 'Forbidden' }, false, 403))

      await expect(refreshLicense()).rejects.toThrow()
    })
  })

  describe('disconnectCloud', () => {
    it('calls the correct endpoint with DELETE', async () => {
      vi.mocked(fetch).mockResolvedValueOnce(makeResponse({ deleted: true }))

      await disconnectCloud()

      const [url, init] = vi.mocked(fetch).mock.calls[0] as [string, RequestInit]
      expect(url).toContain('/api/licensing/binding')
      expect(init.method).toBe('DELETE')
    })

    it('returns deleted: true on success', async () => {
      vi.mocked(fetch).mockResolvedValueOnce(makeResponse({ deleted: true }))

      const result = await disconnectCloud()

      expect(result).toEqual({ deleted: true })
    })

    it('throws ApiError on failure', async () => {
      vi.mocked(fetch).mockResolvedValueOnce(makeResponse({ error: 'Forbidden' }, false, 403))

      await expect(disconnectCloud()).rejects.toThrow()
    })
  })

  describe('getBranding', () => {
    it('calls GET /api/branding and returns config', async () => {
      const payload = { logo_url: null, favicon_url: null, wordmark_text: null, hide_powered_by: false }
      vi.mocked(fetch).mockResolvedValueOnce(makeResponse(payload))

      const result = await getBranding()

      expect(result).toEqual(payload)
      const [url] = vi.mocked(fetch).mock.calls[0] as [string]
      expect(url).toContain('/api/branding')
    })

    it('resolves with stored branding values', async () => {
      const payload = {
        logo_url: 'https://cdn.example.com/logo.svg',
        favicon_url: null,
        wordmark_text: 'MyCloud',
        hide_powered_by: true,
      }
      vi.mocked(fetch).mockResolvedValueOnce(makeResponse(payload))

      const result = await getBranding()

      expect(result.logo_url).toBe('https://cdn.example.com/logo.svg')
      expect(result.wordmark_text).toBe('MyCloud')
      expect(result.hide_powered_by).toBe(true)
    })

    it('throws ApiError on non-ok response', async () => {
      vi.mocked(fetch).mockResolvedValueOnce(makeResponse({ error: 'Internal error' }, false, 500))

      await expect(getBranding()).rejects.toThrow('Internal error')
    })
  })

  describe('saveBranding', () => {
    it('sends PUT /api/admin/branding as multipart', async () => {
      const payload = { logo_url: null, favicon_url: null, wordmark_text: 'MyCloud', hide_powered_by: false }
      vi.mocked(fetch).mockResolvedValueOnce(makeResponse(payload))

      await saveBranding({ wordmark_text: 'MyCloud' })

      const [url, init] = vi.mocked(fetch).mock.calls[0] as [string, RequestInit]
      expect(url).toContain('/api/admin/branding')
      expect(init.method).toBe('PUT')
      expect(init.body).toBeInstanceOf(FormData)
    })

    it('includes logo file in FormData when provided', async () => {
      const payload = {
        logo_url: 'https://cdn/logo.png',
        favicon_url: null,
        wordmark_text: null,
        hide_powered_by: false,
      }
      vi.mocked(fetch).mockResolvedValueOnce(makeResponse(payload))
      const file = new File(['png-data'], 'logo.png', { type: 'image/png' })

      await saveBranding({ logo: file })

      const [, init] = vi.mocked(fetch).mock.calls[0] as [string, RequestInit]
      const form = init.body as FormData
      expect(form.get('logo')).toBe(file)
    })

    it('throws ApiError on 402 (feature gated)', async () => {
      vi.mocked(fetch).mockResolvedValueOnce(
        makeResponse({ error: 'feature_not_available', feature: 'white_label' }, false, 402),
      )

      await expect(saveBranding({ wordmark_text: 'x' })).rejects.toThrow()
    })
  })

  describe('resetBrandingField', () => {
    it('sends DELETE /api/admin/branding/:field', async () => {
      vi.mocked(fetch).mockResolvedValueOnce(makeResponse({ field: 'logo', reset: true }))

      await resetBrandingField('logo')

      const [url, init] = vi.mocked(fetch).mock.calls[0] as [string, RequestInit]
      expect(url).toContain('/api/admin/branding/logo')
      expect(init.method).toBe('DELETE')
    })

    it('throws ApiError on failure', async () => {
      vi.mocked(fetch).mockResolvedValueOnce(makeResponse({ error: 'Forbidden' }, false, 403))

      await expect(resetBrandingField('logo')).rejects.toThrow()
    })
  })

  describe('email config API', () => {
    it('getEmailConfig fetches admin email config', async () => {
      const payload = { enabled: true, provider: 'cloudflare', from: 'no-reply@zpan.space' }
      vi.mocked(fetch).mockResolvedValueOnce(makeResponse(payload))

      const result = await getEmailConfig()

      expect(result).toEqual(payload)
      const [url, init] = vi.mocked(fetch).mock.calls[0] as [string, RequestInit]
      expect(url).toContain('/api/admin/email-config')
      expect(init.method).toBe('GET')
    })

    it('saveEmailConfig PUTs the expected payload', async () => {
      vi.mocked(fetch).mockResolvedValueOnce(makeResponse({ success: true }))

      const payload = { enabled: true, provider: 'cloudflare' as const, from: 'no-reply@zpan.space' }
      await saveEmailConfig(payload)

      const [url, init] = vi.mocked(fetch).mock.calls[0] as [string, RequestInit]
      expect(url).toContain('/api/admin/email-config')
      expect(init.method).toBe('PUT')
      expect(init.body).toBe(JSON.stringify(payload))
    })

    it('saveEmailConfig throws ApiError on failure', async () => {
      vi.mocked(fetch).mockResolvedValueOnce(makeResponse({ error: 'bad config' }, false, 400))

      await expect(
        saveEmailConfig({ enabled: true, provider: 'cloudflare', from: 'no-reply@zpan.space' }),
      ).rejects.toThrow('bad config')
    })

    it('testEmail POSTs recipient to test-messages endpoint', async () => {
      vi.mocked(fetch).mockResolvedValueOnce(makeResponse({ success: true }))

      await testEmail('user@example.com')

      const [url, init] = vi.mocked(fetch).mock.calls[0] as [string, RequestInit]
      expect(url).toContain('/api/admin/email-config/test-messages')
      expect(init.method).toBe('POST')
      expect(init.body).toBe(JSON.stringify({ to: 'user@example.com' }))
    })

    it('testEmail throws ApiError on failure', async () => {
      vi.mocked(fetch).mockResolvedValueOnce(makeResponse({ error: 'send failed' }, false, 400))

      await expect(testEmail('user@example.com')).rejects.toThrow('send failed')
    })
  })
})
