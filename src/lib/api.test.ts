// Tests for src/lib/api.ts — covers all public API helper functions
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  batchDeleteObjects,
  batchMoveObjects,
  batchTrashObjects,
  confirmUpload,
  copyObject,
  createObject,
  createStorage,
  deleteObject,
  deleteShare,
  deleteStorage,
  deleteUser,
  emptyTrash,
  getObject,
  getProfile,
  getSession,
  getShare,
  getStorage,
  getSystemOption,
  getUnreadCount,
  getUserQuota,
  listAuthProviders,
  listNotifications,
  listObjects,
  listQuotas,
  listShares,
  listStorages,
  listSystemOptions,
  listUsers,
  markAllNotificationsRead,
  markNotificationRead,
  restoreObject,
  setSystemOption,
  trashObject,
  updateObject,
  updateQuota,
  updateStorage,
  updateUserStatus,
  uploadToS3,
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
      expect(init.body).toBe(JSON.stringify({ name: 'renamed.txt' }))
    })

    it('patches object by id with parent', async () => {
      const updated = { id: 'id1', parent: 'folder2' }
      vi.mocked(fetch).mockResolvedValueOnce(makeResponse(updated))

      await updateObject('id1', { parent: 'folder2' })

      const [, init] = vi.mocked(fetch).mock.calls[0] as [string, RequestInit]
      expect(init.body).toBe(JSON.stringify({ parent: 'folder2' }))
    })

    it('throws on error response', async () => {
      vi.mocked(fetch).mockResolvedValueOnce(makeResponse({ error: 'forbidden' }, false, 403))

      await expect(updateObject('id1', { name: 'x' })).rejects.toThrow('forbidden')
    })
  })

  describe('confirmUpload', () => {
    it('patches /done endpoint', async () => {
      const obj = { id: 'id1', status: 'active' }
      vi.mocked(fetch).mockResolvedValueOnce(makeResponse(obj))

      const result = await confirmUpload('id1')

      expect(result).toEqual(obj)
      const [url, init] = vi.mocked(fetch).mock.calls[0] as [string, RequestInit]
      expect(url).toBe('/api/objects/id1/done')
      expect(init.method).toBe('PATCH')
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
    it('posts to /copy endpoint with parent in body', async () => {
      const copy = { id: 'copy1', name: 'file.txt' }
      vi.mocked(fetch).mockResolvedValueOnce(makeResponse(copy))

      const result = await copyObject('id1', 'folder2')

      expect(result).toEqual(copy)
      const [url, init] = vi.mocked(fetch).mock.calls[0] as [string, RequestInit]
      expect(url).toContain('/api/objects/id1/copy')
      expect(init.method).toBe('POST')
      const body = typeof init.body === 'string' ? JSON.parse(init.body) : null
      expect(body).toMatchObject({ parent: 'folder2' })
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
    it('sends PATCH to restore endpoint for the given id', async () => {
      const obj = { id: 'id1', status: 'active' }
      vi.mocked(fetch).mockResolvedValueOnce(makeResponse(obj))

      const result = await restoreObject('id1')

      expect(result).toEqual(obj)
      const [url, init] = vi.mocked(fetch).mock.calls[0] as [string, RequestInit]
      expect(url).toContain('/api/objects/id1/restore')
      expect(init.method).toBe('PATCH')
    })

    it('throws on error response', async () => {
      vi.mocked(fetch).mockResolvedValueOnce(makeResponse({ error: 'not found' }, false, 404))

      await expect(restoreObject('missing')).rejects.toThrow('not found')
    })
  })

  describe('emptyTrash', () => {
    it('sends POST to empty trash endpoint', async () => {
      const payload = { purged: 5 }
      vi.mocked(fetch).mockResolvedValueOnce(makeResponse(payload))

      const result = await emptyTrash()

      expect(result).toEqual(payload)
      const [url, init] = vi.mocked(fetch).mock.calls[0] as [string, RequestInit]
      expect(url).toContain('/api/recycle-bin/empty')
      expect(init.method).toBe('POST')
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
    it('puts user status and returns updated user', async () => {
      const updated = { id: 'u1', status: 'active' }
      vi.mocked(fetch).mockResolvedValueOnce(makeResponse(updated))

      const result = await updateUserStatus('u1', 'active')

      expect(result).toEqual(updated)
      const [url, init] = vi.mocked(fetch).mock.calls[0] as [string, RequestInit]
      expect(url).toContain('/api/admin/users/u1/status')
      expect(init.method).toBe('PUT')
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
    it('sends PATCH to trash endpoint for the given id', async () => {
      const obj = { id: 'id1', status: 'trashed' }
      vi.mocked(fetch).mockResolvedValueOnce(makeResponse(obj))

      const result = await trashObject('id1')

      expect(result).toEqual(obj)
      const [url, init] = vi.mocked(fetch).mock.calls[0] as [string, RequestInit]
      expect(url).toContain('/api/objects/id1/trash')
      expect(init.method).toBe('PATCH')
    })

    it('throws on error response', async () => {
      vi.mocked(fetch).mockResolvedValueOnce(makeResponse({ error: 'not found' }, false, 404))

      await expect(trashObject('missing')).rejects.toThrow('not found')
    })
  })

  describe('batchTrashObjects', () => {
    it('posts ids to batch trash endpoint and returns trashed count', async () => {
      const payload = { trashed: 3 }
      vi.mocked(fetch).mockResolvedValueOnce(makeResponse(payload))

      const result = await batchTrashObjects(['id1', 'id2', 'id3'])

      expect(result).toEqual(payload)
      const [url, init] = vi.mocked(fetch).mock.calls[0] as [string, RequestInit]
      expect(url).toContain('/api/objects/batch/trash')
      expect(init.method).toBe('POST')
      const body = typeof init.body === 'string' ? JSON.parse(init.body) : null
      expect(body).toMatchObject({ ids: ['id1', 'id2', 'id3'] })
    })

    it('posts an empty ids array without error', async () => {
      vi.mocked(fetch).mockResolvedValueOnce(makeResponse({ trashed: 0 }))

      const result = await batchTrashObjects([])

      expect(result).toEqual({ trashed: 0 })
      const [, init] = vi.mocked(fetch).mock.calls[0] as [string, RequestInit]
      const body = typeof init.body === 'string' ? JSON.parse(init.body) : null
      expect(body).toMatchObject({ ids: [] })
    })

    it('throws on error response', async () => {
      vi.mocked(fetch).mockResolvedValueOnce(makeResponse({ error: 'forbidden' }, false, 403))

      await expect(batchTrashObjects(['id1'])).rejects.toThrow('forbidden')
    })
  })

  describe('batchMoveObjects', () => {
    it('posts ids and parent to batch move endpoint and returns moved count', async () => {
      const payload = { moved: 2 }
      vi.mocked(fetch).mockResolvedValueOnce(makeResponse(payload))

      const result = await batchMoveObjects(['id1', 'id2'], 'folder1')

      expect(result).toEqual(payload)
      const [url, init] = vi.mocked(fetch).mock.calls[0] as [string, RequestInit]
      expect(url).toContain('/api/objects/batch/move')
      expect(init.method).toBe('POST')
      const body = typeof init.body === 'string' ? JSON.parse(init.body) : null
      expect(body).toMatchObject({ ids: ['id1', 'id2'], parent: 'folder1' })
    })

    it('throws on error response', async () => {
      vi.mocked(fetch).mockResolvedValueOnce(makeResponse({ error: 'not found' }, false, 404))

      await expect(batchMoveObjects(['id1'], 'missing-folder')).rejects.toThrow('not found')
    })
  })

  describe('batchDeleteObjects', () => {
    it('posts ids to batch delete endpoint and returns deleted count', async () => {
      const payload = { deleted: 2 }
      vi.mocked(fetch).mockResolvedValueOnce(makeResponse(payload))

      const result = await batchDeleteObjects(['id1', 'id2'])

      expect(result).toEqual(payload)
      const [url, init] = vi.mocked(fetch).mock.calls[0] as [string, RequestInit]
      expect(url).toContain('/api/objects/batch/delete')
      expect(init.method).toBe('POST')
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
    it('calls /api/notifications/unread-count and returns count', async () => {
      vi.mocked(fetch).mockResolvedValueOnce(makeResponse({ count: 3 }))

      const result = await getUnreadCount()

      expect(result).toEqual({ count: 3 })
      const [url] = vi.mocked(fetch).mock.calls[0] as [string]
      expect(url).toContain('/api/notifications/unread-count')
    })

    it('throws on error response', async () => {
      vi.mocked(fetch).mockResolvedValueOnce(makeResponse({ error: 'unauthorized' }, false, 401))

      await expect(getUnreadCount()).rejects.toThrow('unauthorized')
    })
  })

  describe('markNotificationRead', () => {
    it('posts to /api/notifications/:id/read and resolves on 204', async () => {
      vi.mocked(fetch).mockResolvedValueOnce({ ok: true, status: 204 } as Response)

      await expect(markNotificationRead('notif-1')).resolves.toBeUndefined()
      const [url, init] = vi.mocked(fetch).mock.calls[0] as [string, RequestInit]
      expect(url).toContain('/api/notifications/notif-1/read')
      expect(init.method).toBe('POST')
    })

    it('throws ApiError on non-ok response', async () => {
      vi.mocked(fetch).mockResolvedValueOnce({ ok: false, status: 404, statusText: 'Not Found' } as Response)

      await expect(markNotificationRead('missing')).rejects.toThrow('Not Found')
    })
  })

  describe('markAllNotificationsRead', () => {
    it('posts to /api/notifications/read-all and returns count', async () => {
      vi.mocked(fetch).mockResolvedValueOnce(makeResponse({ count: 5 }))

      const result = await markAllNotificationsRead()

      expect(result).toEqual({ count: 5 })
      const [url, init] = vi.mocked(fetch).mock.calls[0] as [string, RequestInit]
      expect(url).toContain('/api/notifications/read-all')
      expect(init.method).toBe('POST')
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
    it('calls /api/shares/:id and returns share detail', async () => {
      const payload = { id: 'share-1', token: 'abc', kind: 'landing' }
      vi.mocked(fetch).mockResolvedValueOnce(makeResponse(payload))

      const result = await getShare('share-1')

      expect(result).toEqual(payload)
      const [url] = vi.mocked(fetch).mock.calls[0] as [string]
      expect(url).toContain('/api/shares/share-1')
    })

    it('throws on error response', async () => {
      vi.mocked(fetch).mockResolvedValueOnce(makeResponse({ error: 'Not found' }, false, 404))

      await expect(getShare('missing')).rejects.toThrow('Not found')
    })
  })

  describe('deleteShare', () => {
    it('calls DELETE /api/shares/:id and resolves on 204', async () => {
      vi.mocked(fetch).mockResolvedValueOnce({ ok: true, status: 204 } as Response)

      await expect(deleteShare('share-1')).resolves.toBeUndefined()
      const [url, init] = vi.mocked(fetch).mock.calls[0] as [string, RequestInit]
      expect(url).toContain('/api/shares/share-1')
      expect(init.method).toBe('DELETE')
    })

    it('throws ApiError on non-ok response', async () => {
      vi.mocked(fetch).mockResolvedValueOnce({ ok: false, status: 403, statusText: 'Forbidden' } as Response)

      await expect(deleteShare('share-1')).rejects.toThrow('Forbidden')
    })
  })
})
