import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  confirmUpload,
  copyObject,
  createObject,
  deleteObject,
  getObject,
  listObjects,
  updateObject,
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
})
