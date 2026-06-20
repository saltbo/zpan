import { describe, expect, it, vi } from 'vitest'
import type { Platform } from '../../platform/interface'
import type { LicenseBindingRepo, LicenseState, LicensingCloudGateway } from '../../usecases/ports'
import { createImageUploadGateway, isAvatarContentType } from './image-upload'

// biome-ignore lint/suspicious/noExplicitAny: test stub intentionally opaque
type Any = any

const AVATAR_PREFIX = '_system/avatars'
const LOGO_PREFIX = '_system/org-logos'

function mockPlatform(env: Record<string, string | undefined> = {}, avatarsBucket?: unknown): Platform {
  return {
    db: {} as Any,
    getEnv: (k: string) => env[k],
    getBinding: (k: string) => (k === 'PUBLIC_IMAGES' ? avatarsBucket : undefined),
  } as unknown as Platform
}

// In-memory R2 stand-in capturing put/get/delete the gateway issues.
function mockR2Bucket() {
  const store = new Map<string, { body: ArrayBuffer; contentType?: string }>()
  const put = vi.fn(async (key: string, value: ArrayBuffer, opts?: { httpMetadata?: { contentType?: string } }) => {
    store.set(key, { body: value, contentType: opts?.httpMetadata?.contentType })
  })
  const get = vi.fn(async (key: string) => {
    const o = store.get(key)
    return o ? { arrayBuffer: async () => o.body, httpMetadata: { contentType: o.contentType } } : null
  })
  const del = vi.fn(async (key: string) => {
    store.delete(key)
  })
  return { bucket: { put, get, delete: del }, put, get, delete: del, store }
}

function activeBinding(refreshToken: string | null = 'refresh-token'): LicenseState {
  return {
    id: 'binding-1',
    cloudBindingId: 'cb',
    cloudStoreId: null,
    instanceId: 'instance-1',
    cloudAccountId: 'account-1',
    cloudAccountEmail: null,
    status: 'active',
    refreshToken,
    cachedCert: null,
    cachedExpiresAt: null,
    boundAt: 0,
    disconnectedAt: null,
    lastRefreshAt: null,
    lastRefreshError: null,
  }
}

function mockLicenseBinding(binding: LicenseState | null): LicenseBindingRepo {
  return { loadActiveLicenseBinding: vi.fn(async () => binding) } as unknown as LicenseBindingRepo
}

// A fake Cloud client capturing the avatar PUT/DELETE the SDK helper issues. The
// gateway calls the REAL `uploadAvatar`/`deleteAvatar` SDK helpers against it, so
// these spies see exactly what the SDK forwards (param + per-request init).
function mockAvatarClient(putResponse: () => Response = () => json201()) {
  const put = vi.fn(async (_args: unknown, _opt: unknown) => putResponse())
  const del = vi.fn(async (_args: unknown) => new Response(null, { status: 204 }))
  const client = { avatars: { ':scope': { ':id': { $put: put, $delete: del } } } }
  return { client, put, del }
}

function json201(
  body: unknown = { url: 'https://cloud.example/avatars/user/u1.png', key: 'avatars/user/u1' },
): Response {
  return new Response(JSON.stringify(body), { status: 201, headers: { 'content-type': 'application/json' } })
}

function cloudError(status: number, code: string): Response {
  return new Response(JSON.stringify({ error: code }), { status, headers: { 'content-type': 'application/json' } })
}

function mockLicensingCloud(client: unknown) {
  const createAvatarUploadClient = vi.fn(() => client)
  return { gateway: { createAvatarUploadClient } as unknown as LicensingCloudGateway, createAvatarUploadClient }
}

function makeFile(type: string, bytes = 16): File {
  return new File([new Uint8Array(bytes)], `f.${type.split('/')[1] ?? 'bin'}`, { type })
}

describe('isAvatarContentType', () => {
  it('accepts the Cloud avatar content types (incl. gif)', () => {
    expect(isAvatarContentType('image/png')).toBe(true)
    expect(isAvatarContentType('image/jpeg')).toBe(true)
    expect(isAvatarContentType('image/webp')).toBe(true)
    expect(isAvatarContentType('image/gif')).toBe(true)
  })

  it('rejects unsupported mimes', () => {
    expect(isAvatarContentType('application/pdf')).toBe(false)
    expect(isAvatarContentType('image/bmp')).toBe(false)
    expect(isAvatarContentType('')).toBe(false)
    expect(isAvatarContentType(undefined)).toBe(false)
    expect(isAvatarContentType(42)).toBe(false)
  })
})

describe('uploadPublicImage — Cloud avatar service', () => {
  it('uploads a user avatar via the Cloud avatar service with the image content type', async () => {
    const { client, put } = mockAvatarClient()
    const { gateway, createAvatarUploadClient } = mockLicensingCloud(client)
    const gw = createImageUploadGateway(mockLicenseBinding(activeBinding()), gateway)
    const file = makeFile('image/png')

    const result = await gw.uploadPublicImage(
      mockPlatform({ ZPAN_CLOUD_URL: 'https://cloud.example' }),
      AVATAR_PREFIX,
      'u1',
      file,
    )

    expect(result.ok).toBe(true)
    if (result.ok) expect(result.url).toBe('https://cloud.example/avatars/user/u1.png')
    // Bound client built from the active binding's refresh token + the cloud base url.
    expect(createAvatarUploadClient).toHaveBeenCalledWith('https://cloud.example', 'refresh-token')
    // The SDK PUT targets /avatars/user/u1 and sends the IMAGE content type (not JSON).
    expect(put).toHaveBeenCalledOnce()
    expect(put.mock.calls[0]?.[0]).toEqual({ param: { scope: 'user', id: 'u1' } })
    const init = (put.mock.calls[0]?.[1] as { init: { body: unknown; headers: Record<string, string> } }).init
    expect(init.headers['content-type']).toBe('image/png')
    expect(init.body).toBe(file)
  })

  it('maps the org-logo prefix to the team scope', async () => {
    const { client, put } = mockAvatarClient()
    const { gateway } = mockLicensingCloud(client)
    const gw = createImageUploadGateway(mockLicenseBinding(activeBinding()), gateway)

    await gw.uploadPublicImage(mockPlatform(), LOGO_PREFIX, 'team-1', makeFile('image/webp'))

    expect(put.mock.calls[0]?.[0]).toEqual({ param: { scope: 'team', id: 'team-1' } })
  })

  it('rejects an unsupported mime with 400 before any Cloud call', async () => {
    const { client, put } = mockAvatarClient()
    const { gateway, createAvatarUploadClient } = mockLicensingCloud(client)
    const gw = createImageUploadGateway(mockLicenseBinding(activeBinding()), gateway)

    const result = await gw.uploadPublicImage(mockPlatform(), AVATAR_PREFIX, 'u1', makeFile('application/pdf'))

    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.status).toBe(400)
    expect(createAvatarUploadClient).not.toHaveBeenCalled()
    expect(put).not.toHaveBeenCalled()
  })

  it('rejects a file larger than 1 MiB with 413 before any Cloud call', async () => {
    const { client, put } = mockAvatarClient()
    const { gateway } = mockLicensingCloud(client)
    const gw = createImageUploadGateway(mockLicenseBinding(activeBinding()), gateway)

    const result = await gw.uploadPublicImage(
      mockPlatform(),
      AVATAR_PREFIX,
      'u1',
      makeFile('image/png', 2 * 1024 * 1024),
    )

    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.status).toBe(413)
    expect(put).not.toHaveBeenCalled()
  })

  it('returns 503 cloud_required when the instance is not paired to Cloud', async () => {
    const { client, put } = mockAvatarClient()
    const { gateway, createAvatarUploadClient } = mockLicensingCloud(client)
    const gw = createImageUploadGateway(mockLicenseBinding(null), gateway)

    const result = await gw.uploadPublicImage(mockPlatform(), AVATAR_PREFIX, 'u1', makeFile('image/png'))

    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.status).toBe(503)
      expect(result.error).toBe('cloud_required')
    }
    expect(createAvatarUploadClient).not.toHaveBeenCalled()
    expect(put).not.toHaveBeenCalled()
  })

  it('returns 503 cloud_required when the active binding has no refresh token', async () => {
    const { client } = mockAvatarClient()
    const { gateway } = mockLicensingCloud(client)
    const gw = createImageUploadGateway(mockLicenseBinding(activeBinding(null)), gateway)

    const result = await gw.uploadPublicImage(mockPlatform(), AVATAR_PREFIX, 'u1', makeFile('image/png'))

    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.status).toBe(503)
  })

  it.each([
    ['unsupported_media_type', 415, 400],
    ['payload_too_large', 413, 413],
    ['license_inactive', 403, 403],
    ['something_else', 500, 500],
  ])('maps Cloud error %s to local status %i', async (code, cloudStatus, localStatus) => {
    const { client } = mockAvatarClient(() => cloudError(cloudStatus, code))
    const { gateway } = mockLicensingCloud(client)
    const gw = createImageUploadGateway(mockLicenseBinding(activeBinding()), gateway)

    const result = await gw.uploadPublicImage(mockPlatform(), AVATAR_PREFIX, 'u1', makeFile('image/png'))

    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.status).toBe(localStatus)
  })

  it('returns 500 when the Cloud 201 body is malformed', async () => {
    const { client } = mockAvatarClient(() => json201({ nope: true }))
    const { gateway } = mockLicensingCloud(client)
    const gw = createImageUploadGateway(mockLicenseBinding(activeBinding()), gateway)

    const result = await gw.uploadPublicImage(mockPlatform(), AVATAR_PREFIX, 'u1', makeFile('image/png'))

    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.status).toBe(500)
  })

  it('returns 500 when the Cloud request throws', async () => {
    const put = vi.fn(async () => {
      throw new Error('network down')
    })
    const client = { avatars: { ':scope': { ':id': { $put: put, $delete: vi.fn() } } } }
    const { gateway } = mockLicensingCloud(client)
    const gw = createImageUploadGateway(mockLicenseBinding(activeBinding()), gateway)

    const result = await gw.uploadPublicImage(mockPlatform(), AVATAR_PREFIX, 'u1', makeFile('image/png'))

    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.status).toBe(500)
  })
})

describe('deletePublicImageVariants — Cloud avatar service', () => {
  it('deletes the Cloud-hosted avatar for the scope/id', async () => {
    const { client, del } = mockAvatarClient()
    const { gateway } = mockLicensingCloud(client)
    const gw = createImageUploadGateway(mockLicenseBinding(activeBinding()), gateway)

    await gw.deletePublicImageVariants(mockPlatform(), AVATAR_PREFIX, 'u1')

    expect(del).toHaveBeenCalledOnce()
    expect(del.mock.calls[0]?.[0]).toEqual({ param: { scope: 'user', id: 'u1' } })
  })

  it('is a no-op when the instance is not paired to Cloud', async () => {
    const { client, del } = mockAvatarClient()
    const { gateway, createAvatarUploadClient } = mockLicensingCloud(client)
    const gw = createImageUploadGateway(mockLicenseBinding(null), gateway)

    await expect(gw.deletePublicImageVariants(mockPlatform(), AVATAR_PREFIX, 'u1')).resolves.toBeUndefined()
    expect(createAvatarUploadClient).not.toHaveBeenCalled()
    expect(del).not.toHaveBeenCalled()
  })

  it('swallows Cloud delete failures (best-effort)', async () => {
    const del = vi.fn(async () => {
      throw new Error('boom')
    })
    const client = { avatars: { ':scope': { ':id': { $put: vi.fn(), $delete: del } } } }
    const { gateway } = mockLicensingCloud(client)
    const gw = createImageUploadGateway(mockLicenseBinding(activeBinding()), gateway)

    await expect(gw.deletePublicImageVariants(mockPlatform(), LOGO_PREFIX, 'team-1')).resolves.toBeUndefined()
  })
})

describe('uploadPublicImage — PUBLIC_IMAGES R2 binding (self-hosted, no Cloud)', () => {
  it('uploads straight to R2 and returns the instance serve URL, never calling Cloud', async () => {
    const r2 = mockR2Bucket()
    const { gateway, createAvatarUploadClient } = mockLicensingCloud({})
    const gw = createImageUploadGateway(mockLicenseBinding(activeBinding()), gateway)

    const result = await gw.uploadPublicImage(mockPlatform({}, r2.bucket), AVATAR_PREFIX, 'u1', makeFile('image/png'))

    expect(result.ok).toBe(true)
    if (result.ok) expect(result.url).toMatch(/^\/api\/avatar-blobs\/user\/u1\?v=[0-9a-f]{12}$/)
    expect(r2.put).toHaveBeenCalledOnce()
    expect(r2.put.mock.calls[0]?.[0]).toBe('user/u1')
    expect(r2.put.mock.calls[0]?.[2]).toEqual({ httpMetadata: { contentType: 'image/png' } })
    // The R2 binding short-circuits the Cloud path entirely.
    expect(createAvatarUploadClient).not.toHaveBeenCalled()
  })

  it('uses PUBLIC_IMAGES_URL (R2 custom domain) and the team scope for org logos', async () => {
    const r2 = mockR2Bucket()
    const { gateway } = mockLicensingCloud({})
    const gw = createImageUploadGateway(mockLicenseBinding(activeBinding()), gateway)

    const result = await gw.uploadPublicImage(
      mockPlatform({ PUBLIC_IMAGES_URL: 'https://cdn.example.com/' }, r2.bucket),
      LOGO_PREFIX,
      'team-1',
      makeFile('image/webp'),
    )

    expect(result.ok).toBe(true)
    if (result.ok) expect(result.url).toMatch(/^https:\/\/cdn\.example\.com\/team\/team-1\?v=[0-9a-f]{12}$/)
    expect(r2.put.mock.calls[0]?.[0]).toBe('team/team-1')
  })

  it('still validates mime/size before touching R2', async () => {
    const r2 = mockR2Bucket()
    const { gateway } = mockLicensingCloud({})
    const gw = createImageUploadGateway(mockLicenseBinding(activeBinding()), gateway)

    const bad = await gw.uploadPublicImage(
      mockPlatform({}, r2.bucket),
      AVATAR_PREFIX,
      'u1',
      makeFile('application/pdf'),
    )
    expect(bad.ok).toBe(false)
    if (!bad.ok) expect(bad.status).toBe(400)

    const big = await gw.uploadPublicImage(
      mockPlatform({}, r2.bucket),
      AVATAR_PREFIX,
      'u1',
      makeFile('image/png', 2 * 1024 * 1024),
    )
    expect(big.ok).toBe(false)
    if (!big.ok) expect(big.status).toBe(413)

    expect(r2.put).not.toHaveBeenCalled()
  })
})

describe('deletePublicImageVariants — PUBLIC_IMAGES R2 binding', () => {
  it('deletes straight from R2 for the scope/id, never calling Cloud', async () => {
    const r2 = mockR2Bucket()
    const { gateway, createAvatarUploadClient } = mockLicensingCloud({})
    const gw = createImageUploadGateway(mockLicenseBinding(activeBinding()), gateway)

    await gw.deletePublicImageVariants(mockPlatform({}, r2.bucket), AVATAR_PREFIX, 'u1')

    expect(r2.delete).toHaveBeenCalledWith('user/u1')
    expect(createAvatarUploadClient).not.toHaveBeenCalled()
  })

  it('swallows R2 delete failures (best-effort)', async () => {
    const r2 = mockR2Bucket()
    r2.delete.mockRejectedValueOnce(new Error('boom'))
    const { gateway } = mockLicensingCloud({})
    const gw = createImageUploadGateway(mockLicenseBinding(activeBinding()), gateway)

    await expect(
      gw.deletePublicImageVariants(mockPlatform({}, r2.bucket), LOGO_PREFIX, 'team-1'),
    ).resolves.toBeUndefined()
  })
})
