// Tests for src/lib/api.ts — covers all public API helper functions
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  ApiError,
  abortObjectUpload,
  buildShareObjectUrl,
  cancelBackgroundJob,
  cancelCloudOrder,
  clearSessionCache,
  completeObjectUpload,
  confirmIhostImage,
  connectCloud,
  continueCloudOrderPayment,
  copyObject,
  createAnnouncement,
  createBackgroundJob,
  createCloudBillingPortalSession,
  createCloudCheckout,
  createDiscountQuote,
  createDownloadTask,
  createIhostApiKey,
  createIhostImagePresign,
  createObject,
  createRemoteDownloadApiKey,
  createShare,
  createSiteInvitation,
  createStorage,
  createWebDavAppPassword,
  deleteAnnouncement,
  deleteAuthProvider,
  deleteAvatar,
  deleteDownloader,
  deleteIhostConfig,
  deleteIhostImage,
  deleteInviteCode,
  deleteObject,
  deleteStorage,
  deleteTeamLogo,
  disconnectCloud,
  enableIhostFeature,
  generateInviteCodes,
  getAdminDashboardGrowthStats,
  getAdminDashboardOperationsStats,
  getAdminDashboardOverviewStats,
  getAdminDashboardSharingStats,
  getAdminDashboardStorageStats,
  getAdminDashboardTrafficStats,
  getAnnouncement,
  getBackgroundJob,
  getBranding,
  getChangelog,
  getCloudCredits,
  getEmailConfig,
  getIhostConfig,
  getInstanceInfo,
  getLicensingStatus,
  getObject,
  getProfile,
  getSession,
  getShare,
  getSiteInvitation,
  getStorage,
  getSystemOption,
  getTeam,
  getTrashObject,
  getUnreadCount,
  getUserQuota,
  getUserQuotaById,
  grantOrgEntitlement,
  grantUserEntitlement,
  isNameConflictError,
  listActiveAnnouncements,
  listAdminAnnouncements,
  listAdminAuditLogs,
  listAnnouncements,
  listAuthProviders,
  listBackgroundJobs,
  listCloudCreditLedgerEntries,
  listCloudCreditProducts,
  listCloudOrders,
  listCloudProducts,
  listCloudStoreTargets,
  listDownloaders,
  listDownloadTaskEvents,
  listDownloadTasks,
  listIhostApiKeys,
  listIhostImages,
  listInviteCodes,
  listNotifications,
  listObjectsByPath,
  listOrgEntitlements,
  listQuotas,
  listReceivedShares,
  listRemoteDownloadApiKeys,
  listShareObjects,
  listShares,
  listSiteInvitations,
  listStorages,
  listSystemOptions,
  listTeamActivities,
  listTeams,
  listTrash,
  listUserEntitlements,
  listWebDavAppPasswords,
  markAllNotificationsRead,
  markNotificationRead,
  pollPairing,
  presignObjectUploadParts,
  purgeTrashObject,
  redeemCloudGiftCard,
  refreshLicense,
  resendSiteInvitation,
  resetBrandingField,
  restoreObject,
  retryBackgroundJob,
  revokeIhostApiKey,
  revokeOrgEntitlement,
  revokeRemoteDownloadApiKey,
  revokeShare,
  revokeSiteInvitation,
  revokeUserEntitlement,
  revokeWebDavAppPassword,
  runDownloadTaskAction,
  saveBranding,
  saveEmailConfig,
  saveShareToDrive,
  sendDownloaderHeartbeat,
  serverEventsUrl,
  setSystemOption,
  testEmail,
  transferObject,
  updateAnnouncement,
  updateDownloader,
  updateDownloaderCreditBilling,
  updateDownloadTask,
  updateIhostConfig,
  updateObject,
  updateOrgEntitlement,
  updateStorage,
  updateStorageEgressBilling,
  updateUserEntitlement,
  uploadAvatar,
  uploadPartToS3,
  uploadTeamLogo,
  uploadToS3,
  upsertAuthProvider,
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
    clearSessionCache()
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  describe('listObjectsByPath (defaults and unwrap edge cases)', () => {
    it('calls correct URL with defaults', async () => {
      const fetchMock = vi.mocked(fetch)
      fetchMock.mockResolvedValueOnce(makeResponse({ items: [], total: 0, page: 1, pageSize: 500 }))

      await listObjectsByPath('root')

      const [url] = fetchMock.mock.calls[0] as [string, RequestInit]
      expect(url).toContain('/api/objects?')
      expect(url).toContain('path=root')
      expect(url).toContain('page=1')
      expect(url).toContain('pageSize=500')
    })

    it('uses provided page, pageSize, and opts', async () => {
      const fetchMock = vi.mocked(fetch)
      fetchMock.mockResolvedValueOnce(makeResponse({ items: [], total: 0, page: 2, pageSize: 20 }))

      await listObjectsByPath('folder1', 2, 20, { type: 'image', search: 'cat', orgId: 'org-1' })

      const [url] = fetchMock.mock.calls[0] as [string, RequestInit]
      expect(url).toContain('path=folder1')
      expect(url).toContain('page=2')
      expect(url).toContain('pageSize=20')
      expect(url).toContain('type=image')
      expect(url).toContain('search=cat')
      expect(url).toContain('orgId=org-1')
    })

    it('returns parsed paginated response', async () => {
      const payload = { items: [{ id: 'abc' }], total: 1, page: 1, pageSize: 500 }
      vi.mocked(fetch).mockResolvedValueOnce(makeResponse(payload))

      const result = await listObjectsByPath('root')

      expect(result).toEqual(payload)
    })

    it('throws when response is not ok', async () => {
      vi.mocked(fetch).mockResolvedValueOnce(makeResponse({ error: 'forbidden' }, false, 403))

      await expect(listObjectsByPath('root')).rejects.toThrow('forbidden')
    })

    it('falls back to HTTP status when error body has no error field', async () => {
      vi.mocked(fetch).mockResolvedValueOnce(makeResponse({}, false, 500))

      await expect(listObjectsByPath('root')).rejects.toThrow('HTTP 500')
    })

    it('falls back to HTTP status when json parse fails', async () => {
      const res = {
        ok: false,
        status: 503,
        statusText: 'Service Unavailable',
        json: async () => {
          throw new Error('parse error')
        },
      } as unknown as Response
      vi.mocked(fetch).mockResolvedValueOnce(res)

      await expect(listObjectsByPath('root')).rejects.toThrow('HTTP 503')
    })

    it('passes credentials: include', async () => {
      vi.mocked(fetch).mockResolvedValueOnce(makeResponse({ items: [], total: 0, page: 1, pageSize: 500 }))

      await listObjectsByPath('root')

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
      expect(url).toContain('/api/site/invitations?')
      expect(url).toContain('page=2')
      expect(url).toContain('pageSize=10')
      expect(init.method).toBe('GET')
    })

    it('creates a site invitation', async () => {
      vi.mocked(fetch).mockResolvedValueOnce(makeResponse({ id: 'invite-1', email: 'new@example.com' }))

      await createSiteInvitation('new@example.com')

      const [url, init] = vi.mocked(fetch).mock.calls[0] as [string, RequestInit]
      expect(url).toContain('/api/site/invitations')
      expect(init.method).toBe('POST')
      expect(init.body).toBe(JSON.stringify({ email: 'new@example.com' }))
    })

    it('resends a site invitation', async () => {
      vi.mocked(fetch).mockResolvedValueOnce(makeResponse({ id: 'invite-1', email: 'new@example.com' }))

      await resendSiteInvitation('invite-1')

      const [url, init] = vi.mocked(fetch).mock.calls[0] as [string, RequestInit]
      expect(url).toBe('/api/site/invitations/invite-1/deliveries')
      expect(init.method).toBe('POST')
    })

    it('revokes a site invitation (resolves on 204)', async () => {
      vi.mocked(fetch).mockResolvedValueOnce(makeResponse(null, true, 204))

      await expect(revokeSiteInvitation('invite-1')).resolves.toBeUndefined()

      const [url, init] = vi.mocked(fetch).mock.calls[0] as [string, RequestInit]
      expect(url).toBe('/api/site/invitations/invite-1')
      expect(init.method).toBe('DELETE')
    })

    it('gets a public site invitation by token', async () => {
      vi.mocked(fetch).mockResolvedValueOnce(makeResponse({ id: 'invite-1', token: 'token-1' }))

      await getSiteInvitation('token-1')

      const [url, init] = vi.mocked(fetch).mock.calls[0] as [string, RequestInit]
      expect(url).toBe('/api/site/invitations/token-1')
      expect(init.method).toBe('GET')
    })

    it('throws ApiError for failed site invitation create', async () => {
      vi.mocked(fetch).mockResolvedValueOnce(makeResponse({ error: 'duplicate invitation' }, false, 409))

      await expect(createSiteInvitation('new@example.com')).rejects.toThrow('duplicate invitation')
    })
  })

  describe('quota store api', () => {
    it('calls user store endpoints', async () => {
      vi.mocked(fetch)
        .mockResolvedValueOnce(makeResponse({ items: [], total: 0 }))
        .mockResolvedValueOnce(makeResponse({ items: [], total: 0 }))
        .mockResolvedValueOnce(makeResponse({ items: [], total: 0 }))
        .mockResolvedValueOnce(makeResponse({ orderId: 'order-1', url: 'https://cloud.example/checkout' }))
        .mockResolvedValueOnce(makeResponse({ url: 'https://billing.stripe.test/1', stripeSubscriptionId: 'sub_1' }))
        .mockResolvedValueOnce(makeResponse({ items: [], total: 0 }))

      await listCloudProducts()
      await listCloudCreditProducts()
      await listCloudStoreTargets()
      await createCloudCheckout('pkg-1', 'price-usd')
      await createCloudBillingPortalSession()
      await listCloudOrders({ limit: 100, offset: 100 })

      const calls = vi.mocked(fetch).mock.calls as Array<[string, RequestInit]>
      expect(calls[0][0]).toBe('/api/store/packages')
      expect(calls[1][0]).toBe('/api/store/credits/products')
      expect(calls[2][0]).toBe('/api/store/targets')
      expect(calls[3][0]).toBe('/api/store/checkouts')
      expect(JSON.parse(calls[3][1].body as string)).toEqual({
        packageId: 'pkg-1',
        priceId: 'price-usd',
      })
      expect(calls[4][0]).toBe('/api/store/billing-portal-sessions')
      expect(calls[4][1].method).toBe('POST')
      expect(calls[5][0]).toBe('/api/store/orders?limit=100&offset=100')
    })

    it('calls credit balance, credit activity, redemption, and order action endpoints', async () => {
      vi.mocked(fetch)
        .mockResolvedValueOnce(
          makeResponse({
            balance: 500,
          }),
        )
        .mockResolvedValueOnce(
          makeResponse({
            items: [
              {
                id: 'ledger-1',
                creditAccountId: 'credit-account-1',
                creditBucketId: 'credit-bucket-1',
                storeId: 'store-1',
                customerId: 'org-1',
                amount: 500,
                direction: 'credit',
                status: 'posted',
                sourceType: 'gift_card_redemption',
                sourceId: 'gc-1',
                orderId: null,
                paymentId: null,
                createdAt: '2026-05-08T00:00:00.000Z',
              },
            ],
            total: 1,
            limit: 50,
            offset: 0,
          }),
        )
        .mockResolvedValueOnce(
          makeResponse({
            redeemedCredits: 1000,
            entries: [],
            failures: [],
          }),
        )
        .mockResolvedValueOnce(makeResponse({ orderId: 'order-1', url: 'https://cloud.example/pay' }))
        .mockResolvedValueOnce(makeResponse({ id: 'order-1', status: 'canceled' }))

      const credits = await getCloudCredits()
      const ledger = await listCloudCreditLedgerEntries()
      const redeem = await redeemCloudGiftCard('GIFT-123')
      const payment = await continueCloudOrderPayment('order-1')
      const canceled = await cancelCloudOrder('order-1')

      expect(credits).toEqual({ balance: 500 })
      expect(ledger).toEqual({
        items: [
          {
            id: 'ledger-1',
            creditAccountId: 'credit-account-1',
            creditBucketId: 'credit-bucket-1',
            storeId: 'store-1',
            customerId: 'org-1',
            amount: 500,
            direction: 'credit',
            status: 'posted',
            sourceType: 'gift_card_redemption',
            sourceId: 'gc-1',
            orderId: null,
            paymentId: null,
            createdAt: '2026-05-08T00:00:00.000Z',
          },
        ],
        total: 1,
        limit: 50,
        offset: 0,
      })
      expect(redeem).toEqual({ redeemedCredits: 1000, entries: [], failures: [] })
      expect(payment).toEqual({ orderId: 'order-1', url: 'https://cloud.example/pay' })
      expect(canceled).toEqual({ id: 'order-1', status: 'canceled' })

      const calls = vi.mocked(fetch).mock.calls as Array<[string, RequestInit]>
      expect(calls[0][0]).toBe('/api/store/credits')
      expect(calls[1][0]).toBe('/api/store/credits/ledger-entries')
      expect(calls[2][0]).toBe('/api/store/credits/redemptions')
      expect(calls[2][1].method).toBe('POST')
      expect(JSON.parse(calls[2][1].body as string)).toEqual({ code: 'GIFT-123' })
      expect(calls[3][0]).toBe('/api/store/orders/order-1/payments')
      expect(calls[3][1].method).toBe('POST')
      expect(calls[4][0]).toBe('/api/store/orders/order-1/status')
      expect(calls[4][1].method).toBe('PUT')
      expect(JSON.parse(calls[4][1].body as string)).toEqual({ status: 'canceled' })
    })

    it('sends the promotion code in the checkout body when provided', async () => {
      vi.mocked(fetch).mockResolvedValueOnce(
        makeResponse({ orderId: 'order-1', url: 'https://cloud.example/checkout' }),
      )

      const result = await createCloudCheckout('pkg-1', 'price-usd', 'SAVE10')

      expect(result).toEqual({ orderId: 'order-1', url: 'https://cloud.example/checkout' })
      const [url, init] = vi.mocked(fetch).mock.calls[0] as [string, RequestInit]
      expect(url).toBe('/api/store/checkouts')
      expect(init.method).toBe('POST')
      expect(JSON.parse(init.body as string)).toEqual({
        packageId: 'pkg-1',
        priceId: 'price-usd',
        promotionCode: 'SAVE10',
      })
    })

    it('creates a discount quote for a price and code', async () => {
      vi.mocked(fetch).mockResolvedValueOnce(
        makeResponse({ code: 'SAVE10', currency: 'usd', subtotal: 9900, discount: 990, total: 8910 }),
      )

      const quote = await createDiscountQuote('SAVE10', 'price-usd')

      expect(quote).toEqual({ code: 'SAVE10', currency: 'usd', subtotal: 9900, discount: 990, total: 8910 })
      const [url, init] = vi.mocked(fetch).mock.calls[0] as [string, RequestInit]
      expect(url).toBe('/api/store/discount-quotes')
      expect(init.method).toBe('POST')
      expect(JSON.parse(init.body as string)).toEqual({ code: 'SAVE10', priceId: 'price-usd' })
    })

    it.each([
      ['listCloudProducts', () => listCloudProducts()],
      ['listCloudStoreTargets', () => listCloudStoreTargets()],
      ['getCloudCredits', () => getCloudCredits()],
      ['listCloudCreditLedgerEntries', () => listCloudCreditLedgerEntries()],
      ['redeemCloudGiftCard', () => redeemCloudGiftCard('GIFT-123')],
      ['createCloudCheckout', () => createCloudCheckout('pkg-1')],
      ['createDiscountQuote', () => createDiscountQuote('SAVE10', 'price-usd')],
      ['listCloudOrders', () => listCloudOrders()],
    ])('throws ApiError for %s failures', async (_name, call) => {
      vi.mocked(fetch).mockResolvedValueOnce(makeResponse({ error: 'quota store failed' }, false, 400))

      await expect(call()).rejects.toThrow('quota store failed')
    })
  })

  describe('createObject', () => {
    it('posts to /api/objects with JSON body and returns the draft with upload instructions', async () => {
      const created = {
        id: 'new1',
        name: 'doc.pdf',
        upload: { sessionId: 'sess-1', partSize: 5 * 1024 * 1024, urls: ['https://s3/part-1'] },
      }
      vi.mocked(fetch).mockResolvedValueOnce(makeResponse(created))

      const result = await createObject({
        name: 'doc.pdf',
        type: 'application/pdf',
        size: 1024,
        parent: 'root',
        dirtype: 0,
      })

      expect(result).toEqual(created)
      expect(result.upload).toEqual({ sessionId: 'sess-1', partSize: 5 * 1024 * 1024, urls: ['https://s3/part-1'] })
      const [url, init] = vi.mocked(fetch).mock.calls[0] as [string, RequestInit]
      expect(url).toContain('/api/objects')
      expect(init.method).toBe('POST')
      const body = typeof init.body === 'string' ? JSON.parse(init.body) : null
      expect(body).toMatchObject({ name: 'doc.pdf', type: 'application/pdf', size: 1024, parent: 'root', dirtype: 0 })
      const headers =
        init.headers instanceof Headers ? init.headers : new Headers(init.headers as Record<string, string>)
      expect(headers.get('Content-Type')).toContain('application/json')
    })

    it('includes storageId when creating a targeted object draft', async () => {
      vi.mocked(fetch).mockResolvedValueOnce(makeResponse({ id: 'new1', name: 'doc.pdf' }))

      await createObject({
        name: 'doc.pdf',
        type: 'application/pdf',
        size: 1024,
        parent: 'root',
        dirtype: 0,
        storageId: 'st-1',
      })

      const [, init] = vi.mocked(fetch).mock.calls[0] as [string, RequestInit]
      expect(JSON.parse(init.body as string)).toMatchObject({ storageId: 'st-1' })
    })

    it('returns a folder without upload instructions', async () => {
      const created = { id: 'folder1', name: 'photos', type: 'folder' }
      vi.mocked(fetch).mockResolvedValueOnce(makeResponse(created))

      const result = await createObject({ name: 'photos', type: 'folder', parent: 'root', dirtype: 1 })

      expect(result).toEqual(created)
      expect(result.upload).toBeUndefined()
    })

    it('throws on error response', async () => {
      vi.mocked(fetch).mockResolvedValueOnce(makeResponse({ error: 'quota exceeded' }, false, 422))

      await expect(createObject({ name: 'f', type: 't', parent: 'p', dirtype: 0 })).rejects.toThrow('quota exceeded')
    })

    it('throws ApiError with structured targeted-storage failures', async () => {
      vi.mocked(fetch).mockResolvedValueOnce(
        makeResponse(
          {
            error: {
              code: 503,
              message: 'Storage is not active or has no available capacity',
              status: 'UNAVAILABLE',
              details: [{ reason: 'NO_STORAGE_CONFIGURED', domain: 'zpan.dev' }],
            },
          },
          false,
          503,
        ),
      )

      await expect(
        createObject({ name: 'f', type: 't', parent: 'p', dirtype: 0, storageId: 'st-full' }),
      ).rejects.toMatchObject({
        name: 'ApiError',
        status: 503,
        message: 'Storage is not active or has no available capacity',
        reason: 'NO_STORAGE_CONFIGURED',
      })
    })
  })

  describe('completeObjectUpload', () => {
    it('posts parts to /api/objects/:id/uploads/:sessionId/completions and returns the live object', async () => {
      const live = { id: 'obj-1', name: 'doc.pdf', status: 'active' }
      const parts = [
        { partNumber: 1, etag: 'etag-1' },
        { partNumber: 2, etag: 'etag-2' },
      ]
      vi.mocked(fetch).mockResolvedValueOnce(makeResponse(live))

      const result = await completeObjectUpload('obj-1', 'sess-1', parts)

      expect(result).toEqual(live)
      const [url, init] = vi.mocked(fetch).mock.calls[0] as [string, RequestInit]
      expect(url).toBe('/api/objects/obj-1/uploads/sess-1/completions')
      expect(init.method).toBe('POST')
      expect(JSON.parse(init.body as string)).toEqual({ parts })
    })

    it('throws ApiError on error response', async () => {
      vi.mocked(fetch).mockResolvedValueOnce(makeResponse({ error: 'invalid parts' }, false, 400))

      await expect(completeObjectUpload('obj-1', 'sess-1', [])).rejects.toThrow('invalid parts')
    })
  })

  describe('abortObjectUpload', () => {
    it('sends DELETE to /api/objects/:id/uploads/:sessionId and resolves on 204', async () => {
      vi.mocked(fetch).mockResolvedValueOnce(makeResponse(null, true, 204))

      await expect(abortObjectUpload('obj-1', 'sess-1')).resolves.toBeUndefined()

      const [url, init] = vi.mocked(fetch).mock.calls[0] as [string, RequestInit]
      expect(url).toBe('/api/objects/obj-1/uploads/sess-1?')
      expect(init.method).toBe('DELETE')
    })

    it('passes strict cleanup query when requested', async () => {
      vi.mocked(fetch).mockResolvedValueOnce(makeResponse(null, true, 204))

      await abortObjectUpload('obj-1', 'sess-1', { strictStorageCleanup: true })

      const [url, init] = vi.mocked(fetch).mock.calls[0] as [string, RequestInit]
      expect(url).toBe('/api/objects/obj-1/uploads/sess-1?strictStorageCleanup=1')
      expect(init.method).toBe('DELETE')
    })

    it('throws ApiError on error response', async () => {
      vi.mocked(fetch).mockResolvedValueOnce(makeResponse({ error: 'not found' }, false, 404))

      await expect(abortObjectUpload('obj-1', 'missing')).rejects.toThrow('not found')
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

  describe('deleteObject', () => {
    it('sends DELETE request (soft delete to trash) and resolves on 204', async () => {
      vi.mocked(fetch).mockResolvedValueOnce(makeResponse(null, true, 204))

      await expect(deleteObject('id1')).resolves.toBeUndefined()

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
    it('posts to /:id/copies with parent in body', async () => {
      const copy = { id: 'copy1', name: 'file.txt' }
      vi.mocked(fetch).mockResolvedValueOnce(makeResponse(copy))

      const result = await copyObject('id1', 'folder2')

      expect(result).toEqual(copy)
      const [url, init] = vi.mocked(fetch).mock.calls[0] as [string, RequestInit]
      expect(url).toBe('/api/objects/id1/copies')
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

  describe('transferObject', () => {
    it('posts to /:id/transfers with target org, parent, and mode', async () => {
      const payload = { saved: [{ id: 'new1' }], skipped: [], sourceTrashed: true }
      vi.mocked(fetch).mockResolvedValueOnce(makeResponse(payload))

      const result = await transferObject('id1', { targetOrgId: 'org-team', targetParent: 'photos', mode: 'move' })

      expect(result).toEqual(payload)
      const [url, init] = vi.mocked(fetch).mock.calls[0] as [string, RequestInit]
      expect(url).toContain('/api/objects/id1/transfers')
      expect(init.method).toBe('POST')
      const body = typeof init.body === 'string' ? JSON.parse(init.body) : null
      expect(body).toMatchObject({ targetOrgId: 'org-team', targetParent: 'photos', mode: 'move' })
    })

    it('throws on quota exceeded response', async () => {
      vi.mocked(fetch).mockResolvedValueOnce(
        makeResponse(
          {
            error: {
              code: 422,
              message: 'Quota exceeded',
              status: 'RESOURCE_EXHAUSTED',
              details: [
                {
                  '@type': 'type.googleapis.com/google.rpc.ErrorInfo',
                  reason: 'QUOTA_EXCEEDED',
                  domain: 'zpan.dev',
                },
              ],
            },
          },
          false,
          422,
        ),
      )

      await expect(
        transferObject('id1', { targetOrgId: 'org-team', targetParent: '', mode: 'copy' }),
      ).rejects.toMatchObject({ name: 'ApiError', status: 422, reason: 'QUOTA_EXCEEDED' })
    })
  })

  describe('uploadToS3', () => {
    class MockXMLHttpRequest {
      static instances: MockXMLHttpRequest[] = []
      upload = { onprogress: null as ((event: ProgressEvent) => void) | null }
      onload: (() => void) | null = null
      onerror: (() => void) | null = null
      onabort: (() => void) | null = null
      status = 200
      method = ''
      url = ''
      body: unknown
      headers: Record<string, string> = {}

      constructor() {
        MockXMLHttpRequest.instances.push(this)
      }

      open(method: string, url: string) {
        this.method = method
        this.url = url
      }

      setRequestHeader(key: string, value: string) {
        this.headers[key] = value
      }

      send(body: unknown) {
        this.body = body
      }

      abort() {
        this.onabort?.()
      }
    }

    beforeEach(() => {
      MockXMLHttpRequest.instances = []
      vi.stubGlobal('XMLHttpRequest', MockXMLHttpRequest)
    })

    it('PUTs file to presigned URL with correct content-type', async () => {
      const file = new File(['hello'], 'hello.txt', { type: 'text/plain' })
      const promise = uploadToS3('https://s3/presigned', file)
      const xhr = MockXMLHttpRequest.instances[0]
      xhr.onload?.()
      await promise

      expect(xhr.url).toBe('https://s3/presigned')
      expect(xhr.method).toBe('PUT')
      expect(xhr.body).toBe(file)
      expect(xhr.headers['Content-Type']).toBe('text/plain')
    })

    it('falls back to application/octet-stream when file type is empty', async () => {
      const file = new File(['data'], 'blob') // no type
      const promise = uploadToS3('https://s3/presigned', file)
      const xhr = MockXMLHttpRequest.instances[0]
      xhr.onload?.()
      await promise

      expect(xhr.headers['Content-Type']).toBe('application/octet-stream')
    })

    it('does not pass credentials on S3 upload', async () => {
      const file = new File(['x'], 'x.bin')
      const promise = uploadToS3('https://s3/presigned', file)
      const xhr = MockXMLHttpRequest.instances[0]
      xhr.onload?.()
      await promise

      expect('withCredentials' in xhr).toBe(false)
    })

    it('throws when S3 upload fails', async () => {
      const file = new File(['x'], 'x.bin')
      const promise = uploadToS3('https://s3/presigned', file)
      const xhr = MockXMLHttpRequest.instances[0]
      xhr.status = 403
      xhr.onload?.()
      await expect(promise).rejects.toThrow('Upload failed')
    })

    it('reports upload progress', async () => {
      const onProgress = vi.fn()
      const file = new File(['hello'], 'hello.txt', { type: 'text/plain' })
      Object.defineProperty(file, 'size', { value: 10 })

      const promise = uploadToS3('https://s3/presigned', file, { onProgress })
      const xhr = MockXMLHttpRequest.instances[0]
      xhr.upload.onprogress?.({ loaded: 4, total: 10, lengthComputable: true } as ProgressEvent)
      xhr.onload?.()
      await promise

      expect(onProgress).toHaveBeenCalledWith({ loaded: 4, total: 10 })
      expect(onProgress).toHaveBeenLastCalledWith({ loaded: 10, total: 10 })
    })

    it('rejects with AbortError when aborted', async () => {
      const controller = new AbortController()
      const file = new File(['x'], 'x.bin')
      const promise = uploadToS3('https://s3/presigned', file, { signal: controller.signal })

      controller.abort()

      await expect(promise).rejects.toMatchObject({ name: 'AbortError' })
    })

    it('sets Content-Disposition header when option is provided', async () => {
      const file = new File(['hello'], 'hello.txt', { type: 'text/plain' })
      const promise = uploadToS3('https://s3/presigned', file, {
        contentDisposition: 'attachment; filename="hello.txt"',
      })
      const xhr = MockXMLHttpRequest.instances[0]
      xhr.onload?.()
      await promise

      expect(xhr.headers['Content-Disposition']).toBe('attachment; filename="hello.txt"')
    })
  })

  describe('uploadPartToS3', () => {
    class MockPartXHR {
      static instances: MockPartXHR[] = []
      upload = { onprogress: null as ((event: ProgressEvent) => void) | null }
      onload: (() => void) | null = null
      onerror: (() => void) | null = null
      onabort: (() => void) | null = null
      status = 200
      method = ''
      url = ''
      body: unknown
      responseHeaders: Record<string, string> = { ETag: '"etag-abc"' }

      constructor() {
        MockPartXHR.instances.push(this)
      }
      open(method: string, url: string) {
        this.method = method
        this.url = url
      }
      getResponseHeader(key: string) {
        return this.responseHeaders[key] ?? null
      }
      send(body: unknown) {
        this.body = body
      }
      abort() {
        this.onabort?.()
      }
    }

    beforeEach(() => {
      MockPartXHR.instances = []
      vi.stubGlobal('XMLHttpRequest', MockPartXHR)
    })

    it('PUTs the blob and resolves with the unquoted ETag', async () => {
      const blob = new Blob(['chunk'])
      const promise = uploadPartToS3('https://s3/part-1', blob)
      const xhr = MockPartXHR.instances[0]
      xhr.onload?.()

      await expect(promise).resolves.toBe('etag-abc')
      expect(xhr.method).toBe('PUT')
      expect(xhr.url).toBe('https://s3/part-1')
      expect(xhr.body).toBe(blob)
    })

    it('rejects when the ETag header is not exposed', async () => {
      const promise = uploadPartToS3('https://s3/part-1', new Blob(['x']))
      const xhr = MockPartXHR.instances[0]
      xhr.responseHeaders = {}
      xhr.onload?.()

      await expect(promise).rejects.toThrow(/ETag/)
    })

    it('rejects when the part upload fails', async () => {
      const promise = uploadPartToS3('https://s3/part-1', new Blob(['x']))
      const xhr = MockPartXHR.instances[0]
      xhr.status = 500
      xhr.onload?.()

      await expect(promise).rejects.toThrow('Upload failed')
    })

    it('rejects immediately when the signal is already aborted', async () => {
      const controller = new AbortController()
      controller.abort()
      const promise = uploadPartToS3('https://s3/part-1', new Blob(['x']), { signal: controller.signal })

      await expect(promise).rejects.toMatchObject({ name: 'AbortError' })
      expect(MockPartXHR.instances[0]?.body).toBeUndefined()
    })

    it('rejects on a network error', async () => {
      const promise = uploadPartToS3('https://s3/part-1', new Blob(['x']))
      const xhr = MockPartXHR.instances[0]
      xhr.onerror?.()

      await expect(promise).rejects.toThrow('Upload failed')
    })

    it('reports progress and rejects on abort', async () => {
      const onProgress = vi.fn()
      const controller = new AbortController()
      const promise = uploadPartToS3('https://s3/part-1', new Blob(['x']), {
        onProgress,
        signal: controller.signal,
      })
      const xhr = MockPartXHR.instances[0]
      xhr.upload.onprogress?.({ loaded: 2, total: 8, lengthComputable: true } as ProgressEvent)
      expect(onProgress).toHaveBeenCalledWith({ loaded: 2, total: 8 })
      controller.abort()
      await expect(promise).rejects.toMatchObject({ name: 'AbortError' })
    })
  })

  describe('presignObjectUploadParts', () => {
    it('presigns parts via POST /api/objects/:id/uploads/:sessionId/parts', async () => {
      const payload = {
        uploadId: 'mp-1',
        partSize: 5 * 1024 * 1024,
        parts: [{ partNumber: 1, url: 'https://s3/part-1' }],
      }
      vi.mocked(fetch).mockResolvedValueOnce(makeResponse(payload))

      const result = await presignObjectUploadParts('obj-1', 'sess-1', { partNumbers: [1] })

      expect(result).toEqual(payload)
      const [url, init] = vi.mocked(fetch).mock.calls[0] as [string, RequestInit]
      expect(url).toBe('/api/objects/obj-1/uploads/sess-1/parts')
      expect(init.method).toBe('POST')
      expect(init.body).toBe(JSON.stringify({ partNumbers: [1] }))
    })

    it('throws ApiError on error response', async () => {
      vi.mocked(fetch).mockResolvedValueOnce(makeResponse({ error: 'upload denied' }, false, 403))

      await expect(presignObjectUploadParts('obj-1', 'sess-1', { partNumbers: [1] })).rejects.toThrow('upload denied')
    })
  })

  describe('listTrash', () => {
    it('calls GET /api/trash/objects with default pagination', async () => {
      const payload = { items: [], total: 0, page: 1, pageSize: 20 }
      vi.mocked(fetch).mockResolvedValueOnce(makeResponse(payload))

      const result = await listTrash()

      expect(result).toEqual(payload)
      const [url, init] = vi.mocked(fetch).mock.calls[0] as [string, RequestInit]
      expect(url).toContain('/api/trash/objects?')
      expect(url).toContain('page=1')
      expect(url).toContain('pageSize=20')
      expect(init.method).toBe('GET')
    })

    it('passes provided page and pageSize', async () => {
      vi.mocked(fetch).mockResolvedValueOnce(makeResponse({ items: [], total: 0, page: 3, pageSize: 50 }))

      await listTrash(3, 50)

      const [url] = vi.mocked(fetch).mock.calls[0] as [string, RequestInit]
      expect(url).toContain('page=3')
      expect(url).toContain('pageSize=50')
    })

    it('throws on error response', async () => {
      vi.mocked(fetch).mockResolvedValueOnce(makeResponse({ error: 'forbidden' }, false, 403))

      await expect(listTrash()).rejects.toThrow('forbidden')
    })
  })

  describe('getTrashObject', () => {
    it('fetches a trashed object via GET /api/trash/objects/:id', async () => {
      // A trashed object is active with trashedAt set.
      const obj = { id: 'id1', name: 'file.txt', status: 'active', trashedAt: 1700000000000 }
      vi.mocked(fetch).mockResolvedValueOnce(makeResponse(obj))

      const result = await getTrashObject('id1')

      expect(result).toEqual(obj)
      const [url, init] = vi.mocked(fetch).mock.calls[0] as [string, RequestInit]
      expect(url).toBe('/api/trash/objects/id1')
      expect(init.method).toBe('GET')
    })

    it('throws on error response', async () => {
      vi.mocked(fetch).mockResolvedValueOnce(makeResponse({ error: 'not found' }, false, 404))

      await expect(getTrashObject('missing')).rejects.toThrow('not found')
    })
  })

  describe('restoreObject', () => {
    it('posts to /api/trash/objects/:id/restorations and returns the restored object', async () => {
      const obj = { id: 'id1', status: 'active' }
      vi.mocked(fetch).mockResolvedValueOnce(makeResponse(obj))

      const result = await restoreObject('id1')

      expect(result).toEqual(obj)
      const [url, init] = vi.mocked(fetch).mock.calls[0] as [string, RequestInit]
      expect(url).toBe('/api/trash/objects/id1/restorations')
      expect(init.method).toBe('POST')
      const body = typeof init.body === 'string' ? JSON.parse(init.body) : null
      expect(body).toEqual({})
    })

    it('forwards an onConflict strategy in the body', async () => {
      vi.mocked(fetch).mockResolvedValueOnce(makeResponse({ id: 'id1', status: 'active' }))

      await restoreObject('id1', 'rename')

      const [, init] = vi.mocked(fetch).mock.calls[0] as [string, RequestInit]
      const body = typeof init.body === 'string' ? JSON.parse(init.body) : null
      expect(body).toEqual({ onConflict: 'rename' })
    })

    it('throws on error response', async () => {
      vi.mocked(fetch).mockResolvedValueOnce(makeResponse({ error: 'not found' }, false, 404))

      await expect(restoreObject('missing')).rejects.toThrow('not found')
    })
  })

  describe('purgeTrashObject', () => {
    it('sends DELETE to /api/trash/objects/:id and resolves on 204', async () => {
      vi.mocked(fetch).mockResolvedValueOnce(makeResponse(null, true, 204))

      await expect(purgeTrashObject('id1')).resolves.toBeUndefined()

      const [url, init] = vi.mocked(fetch).mock.calls[0] as [string, RequestInit]
      expect(url).toBe('/api/trash/objects/id1')
      expect(init.method).toBe('DELETE')
    })

    it('throws on error response', async () => {
      vi.mocked(fetch).mockResolvedValueOnce(makeResponse({ error: 'server error' }, false, 500))

      await expect(purgeTrashObject('id1')).rejects.toThrow('server error')
    })
  })

  describe('remote download api', () => {
    it('lists download tasks with filters', async () => {
      const payload = { items: [], total: 0, page: 2, pageSize: 10 }
      vi.mocked(fetch).mockResolvedValueOnce(makeResponse(payload))

      const result = await listDownloadTasks({
        status: 'downloading',
        assignedTo: 'me',
        category: 'movies',
        tag: '4k',
        sortBy: 'progress',
        sortDir: 'asc',
        page: 2,
        pageSize: 10,
      })

      expect(result).toEqual(payload)
      const [url, init] = vi.mocked(fetch).mock.calls[0] as [string, RequestInit]
      expect(url).toContain('/api/downloads/tasks?')
      expect(url).toContain('status=downloading')
      expect(url).toContain('assignedTo=me')
      expect(url).toContain('category=movies')
      expect(url).toContain('tag=4k')
      expect(url).toContain('sortBy=progress')
      expect(url).toContain('sortDir=asc')
      expect(url).toContain('page=2')
      expect(url).toContain('pageSize=10')
      expect(init.method).toBe('GET')
    })

    it('creates a download task', async () => {
      const payload = { id: 'task-1', status: 'queued' }
      const body = {
        source: { type: 'http' as const, uri: 'https://example.com/file.zip' },
        targetFolder: 'root',
        category: 'archives',
        tags: ['backup', '2026'],
      }
      vi.mocked(fetch).mockResolvedValueOnce(makeResponse(payload))

      const result = await createDownloadTask(body)

      expect(result).toEqual(payload)
      const [url, init] = vi.mocked(fetch).mock.calls[0] as [string, RequestInit]
      expect(url).toContain('/api/downloads/tasks')
      expect(init.method).toBe('POST')
      expect(init.body).toBe(JSON.stringify(body))
    })

    it('updates a download task', async () => {
      const payload = { id: 'task-1', status: 'downloading' }
      const body = { status: 'downloading' as const, progress: { download: { bytes: 1024, bytesPerSecond: 0 } } }
      vi.mocked(fetch).mockResolvedValueOnce(makeResponse(payload))

      const result = await updateDownloadTask('task-1', body)

      expect(result).toEqual(payload)
      const [url, init] = vi.mocked(fetch).mock.calls[0] as [string, RequestInit]
      expect(url).toContain('/api/downloads/tasks/task-1')
      expect(init.method).toBe('PATCH')
      expect(init.body).toBe(JSON.stringify(body))
    })

    it('lists download task events', async () => {
      const payload = { items: [{ id: 'event-1', action: 'download_task_created' }] }
      vi.mocked(fetch).mockResolvedValueOnce(makeResponse(payload))

      const result = await listDownloadTaskEvents('task-1')

      expect(result).toEqual(payload)
      const [url, init] = vi.mocked(fetch).mock.calls[0] as [string, RequestInit]
      expect(url).toBe('/api/downloads/tasks/task-1/events')
      expect(init.method).toBe('GET')
    })

    it('throws when listing download task events fails', async () => {
      vi.mocked(fetch).mockResolvedValueOnce(makeResponse({ error: 'not found' }, false, 404))

      await expect(listDownloadTaskEvents('missing')).rejects.toThrow('not found')
    })

    it('pauses a download task via PUT /status', async () => {
      const payload = { id: 'task-1', status: 'paused' }
      vi.mocked(fetch).mockResolvedValueOnce(makeResponse(payload))

      const result = await runDownloadTaskAction('task-1', 'pause')

      expect(result).toEqual(payload)
      const [url, init] = vi.mocked(fetch).mock.calls[0] as [string, RequestInit]
      expect(url).toBe('/api/downloads/tasks/task-1/status')
      expect(init.method).toBe('PUT')
      expect(init.body).toBe(JSON.stringify({ status: 'paused' }))
    })

    it('resumes a download task via PUT /status with queued', async () => {
      vi.mocked(fetch).mockResolvedValueOnce(makeResponse({ id: 'task-1', status: 'queued' }))

      await runDownloadTaskAction('task-1', 'resume')

      const [url, init] = vi.mocked(fetch).mock.calls[0] as [string, RequestInit]
      expect(url).toBe('/api/downloads/tasks/task-1/status')
      expect(init.method).toBe('PUT')
      expect(init.body).toBe(JSON.stringify({ status: 'queued' }))
    })

    it('cancels a download task via PUT /status with canceled', async () => {
      vi.mocked(fetch).mockResolvedValueOnce(makeResponse({ id: 'task-1', status: 'canceled' }))

      await runDownloadTaskAction('task-1', 'cancel')

      const [url, init] = vi.mocked(fetch).mock.calls[0] as [string, RequestInit]
      expect(url).toBe('/api/downloads/tasks/task-1/status')
      expect(init.method).toBe('PUT')
      expect(init.body).toBe(JSON.stringify({ status: 'canceled' }))
    })

    it('retries a download task via POST /attempts', async () => {
      vi.mocked(fetch).mockResolvedValueOnce(makeResponse({ id: 'task-1', status: 'queued' }, true, 201))

      await runDownloadTaskAction('task-1', 'retry')

      const [url, init] = vi.mocked(fetch).mock.calls[0] as [string, RequestInit]
      expect(url).toBe('/api/downloads/tasks/task-1/attempts')
      expect(init.method).toBe('POST')
      expect(init.body).toBe(JSON.stringify({ fresh: false }))
    })

    it('restarts a download task via POST /attempts with fresh', async () => {
      vi.mocked(fetch).mockResolvedValueOnce(makeResponse({ id: 'task-1', status: 'queued' }, true, 201))

      await runDownloadTaskAction('task-1', 'restart')

      const [url, init] = vi.mocked(fetch).mock.calls[0] as [string, RequestInit]
      expect(url).toBe('/api/downloads/tasks/task-1/attempts')
      expect(init.method).toBe('POST')
      expect(init.body).toBe(JSON.stringify({ fresh: true }))
    })

    it('deletes a download task via DELETE (resolves on 204)', async () => {
      vi.mocked(fetch).mockResolvedValueOnce(makeResponse(null, true, 204))

      await expect(runDownloadTaskAction('task-1', 'delete')).resolves.toBeUndefined()

      const [url, init] = vi.mocked(fetch).mock.calls[0] as [string, RequestInit]
      expect(url).toBe('/api/downloads/tasks/task-1')
      expect(init.method).toBe('DELETE')
    })

    it('throws ApiError on download task action failure', async () => {
      vi.mocked(fetch).mockResolvedValueOnce(makeResponse({ error: 'Only active tasks can be paused' }, false, 409))

      await expect(runDownloadTaskAction('task-1', 'pause')).rejects.toThrow('Only active tasks can be paused')
    })

    it('builds the unified server events URL from RPC client', () => {
      expect(serverEventsUrl().pathname).toBe('/api/events')

      const url = serverEventsUrl({ downloadTasks: '1', dtStatus: 'downloading', dtSortDir: 'desc' })
      expect(url.pathname).toBe('/api/events')
      expect(url.searchParams.get('downloadTasks')).toBe('1')
      expect(url.searchParams.get('dtStatus')).toBe('downloading')
      expect(url.searchParams.get('dtSortDir')).toBe('desc')
    })

    it('lists admin downloaders', async () => {
      const payload = { items: [{ id: 'downloader-1', name: 'vps-1' }], total: 1 }
      vi.mocked(fetch).mockResolvedValueOnce(makeResponse(payload))

      const result = await listDownloaders()

      expect(result).toEqual(payload)
      const [url, init] = vi.mocked(fetch).mock.calls[0] as [string, RequestInit]
      expect(url).toContain('/api/downloads/downloaders')
      expect(init.method).toBe('GET')
    })

    it('updates an admin downloader', async () => {
      const payload = { id: 'downloader-1', enabled: false }
      const body = { enabled: false }
      vi.mocked(fetch).mockResolvedValueOnce(makeResponse(payload))

      const result = await updateDownloader('downloader-1', body)

      expect(result).toEqual(payload)
      const [url, init] = vi.mocked(fetch).mock.calls[0] as [string, RequestInit]
      expect(url).toContain('/api/downloads/downloaders/downloader-1')
      expect(init.method).toBe('PATCH')
      expect(init.body).toBe(JSON.stringify(body))
    })

    it('updates downloader credit billing via dedicated route', async () => {
      const payload = { id: 'downloader-1', remoteDownloadCreditBillingEnabled: true }
      const body = { enabled: true, unitBytes: 2048, creditsPerUnit: 3 }
      vi.mocked(fetch).mockResolvedValueOnce(makeResponse(payload))

      const result = await updateDownloaderCreditBilling('downloader-1', body)

      expect(result).toEqual(payload)
      const [url, init] = vi.mocked(fetch).mock.calls[0] as [string, RequestInit]
      expect(url).toContain('/api/downloads/downloaders/downloader-1/credit-billing')
      expect(init.method).toBe('PUT')
      expect(init.body).toBe(JSON.stringify(body))
    })

    it('throws ApiError on downloader credit billing failure', async () => {
      vi.mocked(fetch).mockResolvedValueOnce(makeResponse({ error: 'Feature not available' }, false, 402))

      await expect(
        updateDownloaderCreditBilling('downloader-1', { enabled: true, unitBytes: 1, creditsPerUnit: 1 }),
      ).rejects.toBeInstanceOf(ApiError)
    })

    it('deletes an admin downloader (resolves on 204)', async () => {
      vi.mocked(fetch).mockResolvedValueOnce(makeResponse(null, true, 204))

      await expect(deleteDownloader('downloader-1')).resolves.toBeUndefined()

      const [url, init] = vi.mocked(fetch).mock.calls[0] as [string, RequestInit]
      expect(url).toContain('/api/downloads/downloaders/downloader-1')
      expect(init.method).toBe('DELETE')
    })

    it('sends downloader heartbeat', async () => {
      const payload = { id: 'downloader-1', status: 'online' }
      const body = {
        version: '0.1.0',
        hostname: 'vps-1',
        platform: 'linux',
        arch: 'amd64',
        engine: 'aria2' as const,
        capabilities: ['http'],
        maxConcurrentTasks: 2,
        currentTasks: 1,
        downloadBps: 2048,
        uploadBps: 512,
        freeDiskBytes: 1024,
      }
      vi.mocked(fetch).mockResolvedValueOnce(makeResponse(payload))

      const result = await sendDownloaderHeartbeat(body)

      expect(result).toEqual(payload)
      const [url, init] = vi.mocked(fetch).mock.calls[0] as [string, RequestInit]
      expect(url).toContain('/api/downloads/downloaders/me/heartbeats')
      expect(init.method).toBe('POST')
      expect(init.body).toBe(JSON.stringify(body))
    })

    it('throws ApiError on download task failure', async () => {
      vi.mocked(fetch).mockResolvedValueOnce(makeResponse({ error: 'credits exhausted' }, false, 402))

      await expect(
        updateDownloadTask('task-1', { progress: { download: { bytes: 2048, bytesPerSecond: 0 } } }),
      ).rejects.toThrow('credits exhausted')
    })
  })

  describe('background jobs api', () => {
    const job = {
      id: 'job-1',
      orgId: 'org-1',
      userId: 'user-1',
      type: 'archive_compress',
      status: 'completed',
      targetFolder: null,
      targetPath: null,
      metadata: null,
      progress: {
        inputBytes: 10,
        outputBytes: 20,
        processedBytes: 10,
        fileCount: 1,
        currentFilename: null,
      },
      errorMessage: null,
      resultMetadata: { outputName: 'files.zip' },
      retryable: false,
      cancelable: false,
      retriedFromJobId: null,
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
      startedAt: '2026-01-01T00:00:01.000Z',
      finishedAt: '2026-01-01T00:00:02.000Z',
    }

    it('lists jobs with status, type, and pagination query', async () => {
      const payload = { items: [job], total: 1, page: 2, pageSize: 10 }
      vi.mocked(fetch).mockResolvedValueOnce(makeResponse(payload))

      const result = await listBackgroundJobs({
        status: 'failed',
        type: 'archive_extract',
        page: 2,
        pageSize: 10,
      })

      expect(result).toEqual(payload)
      const [url, init] = vi.mocked(fetch).mock.calls[0] as [string, RequestInit]
      expect(url).toContain('/api/background-jobs?')
      expect(url).toContain('status=failed')
      expect(url).toContain('type=archive_extract')
      expect(url).toContain('page=2')
      expect(url).toContain('pageSize=10')
      expect(init.method).toBe('GET')
    })

    it('creates a background job with JSON payload', async () => {
      vi.mocked(fetch).mockResolvedValueOnce(makeResponse(job, true, 201))

      const result = await createBackgroundJob({ type: 'archive_compress', matterIds: ['file-1', 'folder-1'] })

      expect(result).toEqual(job)
      const [url, init] = vi.mocked(fetch).mock.calls[0] as [string, RequestInit]
      expect(url).toBe('/api/background-jobs')
      expect(init.method).toBe('POST')
      expect(init.body).toBe(JSON.stringify({ type: 'archive_compress', matterIds: ['file-1', 'folder-1'] }))
    })

    it('gets a background job by id', async () => {
      vi.mocked(fetch).mockResolvedValueOnce(makeResponse(job))

      const result = await getBackgroundJob('job-1')

      expect(result).toEqual(job)
      const [url, init] = vi.mocked(fetch).mock.calls[0] as [string, RequestInit]
      expect(url).toBe('/api/background-jobs/job-1')
      expect(init.method).toBe('GET')
    })

    it('cancels a background job', async () => {
      vi.mocked(fetch).mockResolvedValueOnce(makeResponse({ ...job, status: 'canceled' }))

      const result = await cancelBackgroundJob('job-1')

      expect(result.status).toBe('canceled')
      const [url, init] = vi.mocked(fetch).mock.calls[0] as [string, RequestInit]
      expect(url).toBe('/api/background-jobs/job-1/status')
      expect(init.method).toBe('PUT')
      expect(init.body).toBe(JSON.stringify({ status: 'canceled' }))
    })

    it('retries a failed background job', async () => {
      vi.mocked(fetch).mockResolvedValueOnce(makeResponse({ ...job, id: 'job-2' }, true, 201))

      const result = await retryBackgroundJob('job-1')

      expect(result.id).toBe('job-2')
      const [url, init] = vi.mocked(fetch).mock.calls[0] as [string, RequestInit]
      expect(url).toBe('/api/background-jobs/job-1/retries')
      expect(init.method).toBe('POST')
    })

    it('throws ApiError for background job failures', async () => {
      vi.mocked(fetch).mockResolvedValueOnce(
        makeResponse(
          {
            error: {
              code: 409,
              message: 'Background job cannot be retried',
              status: 'FAILED_PRECONDITION',
              details: [],
            },
          },
          false,
          409,
        ),
      )

      await expect(retryBackgroundJob('job-1')).rejects.toMatchObject({
        name: 'ApiError',
        status: 409,
        message: 'Background job cannot be retried',
      })
    })
  })

  describe('listStorages', () => {
    it('fetches storages list', async () => {
      const payload = { items: [{ id: 's1', name: 'main' }], total: 1 }
      vi.mocked(fetch).mockResolvedValueOnce(makeResponse(payload))

      const result = await listStorages()

      expect(result).toEqual(payload)
      const [url] = vi.mocked(fetch).mock.calls[0] as [string]
      expect(url).toContain('/api/site/storages')
    })

    it('throws on error response', async () => {
      vi.mocked(fetch).mockResolvedValueOnce(makeResponse({ error: 'forbidden' }, false, 403))

      await expect(listStorages()).rejects.toThrow('forbidden')
    })
  })

  describe('createStorage', () => {
    const validInput = {
      provider: 'aws-s3',
      bucket: 'files',
      endpoint: 'https://minio.example.com',
      region: 'us-east-1',
      accessKey: 'key',
      secretKey: 'secret',
      capacity: 1073741824,
      forcePathStyle: false,
    }

    it('posts storage data and returns created storage', async () => {
      const storage = { id: 's1', bucket: 'files' }
      vi.mocked(fetch).mockResolvedValueOnce(makeResponse(storage))

      const result = await createStorage(validInput)

      expect(result).toEqual(storage)
      const [url, init] = vi.mocked(fetch).mock.calls[0] as [string, RequestInit]
      expect(url).toContain('/api/site/storages')
      expect(init.method).toBe('POST')
      const body = typeof init.body === 'string' ? JSON.parse(init.body) : null
      expect(body).toMatchObject({ provider: 'aws-s3', bucket: 'files', forcePathStyle: false })
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
      expect(url).toContain('/api/site/storages/s1')
    })

    it('throws on error response', async () => {
      vi.mocked(fetch).mockResolvedValueOnce(makeResponse({ error: 'not found' }, false, 404))

      await expect(getStorage('missing')).rejects.toThrow('not found')
    })
  })

  describe('updateStorage', () => {
    it('puts updated storage data and returns updated storage', async () => {
      const storage = { id: 's1', bucket: 'updated-files' }
      vi.mocked(fetch).mockResolvedValueOnce(makeResponse(storage))

      const result = await updateStorage('s1', {
        provider: 'custom-s3',
        bucket: 'updated-files',
        forcePathStyle: false,
      })

      expect(result).toEqual(storage)
      const [url, init] = vi.mocked(fetch).mock.calls[0] as [string, RequestInit]
      expect(url).toContain('/api/site/storages/s1')
      expect(init.method).toBe('PUT')
      const body = typeof init.body === 'string' ? JSON.parse(init.body) : null
      expect(body).toMatchObject({ provider: 'custom-s3', bucket: 'updated-files', forcePathStyle: false })
    })

    it('throws on error response', async () => {
      vi.mocked(fetch).mockResolvedValueOnce(makeResponse({ error: 'forbidden' }, false, 403))

      await expect(updateStorage('s1', { bucket: 'x' })).rejects.toThrow('forbidden')
    })
  })

  describe('updateStorageEgressBilling', () => {
    it('puts storage egress billing data and returns updated storage', async () => {
      const storage = { id: 's1', egressCreditBillingEnabled: true }
      const body = { enabled: true, unitBytes: 2048, creditsPerUnit: 3 }
      vi.mocked(fetch).mockResolvedValueOnce(makeResponse(storage))

      const result = await updateStorageEgressBilling('s1', body)

      expect(result).toEqual(storage)
      const [url, init] = vi.mocked(fetch).mock.calls[0] as [string, RequestInit]
      expect(url).toContain('/api/site/storages/s1/egress-billing')
      expect(init.method).toBe('PUT')
      expect(init.body).toBe(JSON.stringify(body))
    })

    it('throws ApiError on error response', async () => {
      vi.mocked(fetch).mockResolvedValueOnce(makeResponse({ error: 'Feature not available' }, false, 402))

      await expect(
        updateStorageEgressBilling('s1', { enabled: true, unitBytes: 1, creditsPerUnit: 1 }),
      ).rejects.toBeInstanceOf(ApiError)
    })
  })

  describe('deleteStorage', () => {
    it('sends DELETE request (resolves on 204)', async () => {
      vi.mocked(fetch).mockResolvedValueOnce(makeResponse(null, true, 204))

      await expect(deleteStorage('s1')).resolves.toBeUndefined()

      const [url, init] = vi.mocked(fetch).mock.calls[0] as [string, RequestInit]
      expect(url).toContain('/api/site/storages/s1')
      expect(init.method).toBe('DELETE')
    })

    it('throws on error response', async () => {
      vi.mocked(fetch).mockResolvedValueOnce(makeResponse({ error: 'not found' }, false, 404))

      await expect(deleteStorage('missing')).rejects.toThrow('not found')
    })
  })

  describe('user entitlements', () => {
    it('lists user quota entitlements', async () => {
      const payload = {
        orgId: 'org-1',
        items: [
          {
            id: 'ent-1',
            orgId: 'org-1',
            resourceType: 'storage',
            entitlementType: 'plan',
            source: 'free_plan',
            sourceId: 'free_plan:org-1',
            bytes: 1024,
            startsAt: '2026-05-01T00:00:00.000Z',
            expiresAt: null,
            status: 'active',
            metadata: null,
            createdAt: '2026-05-01T00:00:00.000Z',
            updatedAt: '2026-05-01T00:00:00.000Z',
          },
        ],
      }
      vi.mocked(fetch).mockResolvedValueOnce(makeResponse(payload))

      const result = await listUserEntitlements('u1')

      expect(result).toEqual(payload)
      const [url, init] = vi.mocked(fetch).mock.calls[0] as [string, RequestInit]
      expect(url).toContain('/api/users/u1/entitlements')
      expect(init.method).toBe('GET')
    })

    it('grants a user quota entitlement', async () => {
      const payload = {
        orgId: 'org-1',
        entitlement: {
          id: 'ent-2',
          orgId: 'org-1',
          resourceType: 'storage',
          entitlementType: 'grant',
          source: 'admin_grant',
          sourceId: 'admin_grant:1',
          bytes: 2048,
          startsAt: '2026-05-01T00:00:00.000Z',
          expiresAt: null,
          status: 'active',
          metadata: null,
          createdAt: '2026-05-01T00:00:00.000Z',
          updatedAt: '2026-05-01T00:00:00.000Z',
        },
      }
      vi.mocked(fetch).mockResolvedValueOnce(makeResponse(payload))

      const result = await grantUserEntitlement('u1', { resourceType: 'storage', bytes: 2048, expiresAt: null })

      expect(result).toEqual(payload)
      const [url, init] = vi.mocked(fetch).mock.calls[0] as [string, RequestInit]
      expect(url).toContain('/api/users/u1/entitlements')
      expect(init.method).toBe('POST')
      const body = typeof init.body === 'string' ? JSON.parse(init.body) : null
      expect(body).toMatchObject({ resourceType: 'storage', bytes: 2048, expiresAt: null })
    })

    it('updates a user quota entitlement', async () => {
      const payload = {
        orgId: 'org-1',
        entitlement: {
          id: 'ent-2',
          orgId: 'org-1',
          resourceType: 'storage',
          entitlementType: 'grant',
          source: 'admin_grant',
          sourceId: 'admin_grant:1',
          bytes: 4096,
          startsAt: '2026-05-01T00:00:00.000Z',
          expiresAt: null,
          status: 'active',
          metadata: null,
          createdAt: '2026-05-01T00:00:00.000Z',
          updatedAt: '2026-05-02T00:00:00.000Z',
        },
      }
      vi.mocked(fetch).mockResolvedValueOnce(makeResponse(payload))

      const result = await updateUserEntitlement('u1', 'ent-2', { bytes: 4096, expiresAt: null })

      expect(result).toEqual(payload)
      const [url, init] = vi.mocked(fetch).mock.calls[0] as [string, RequestInit]
      expect(url).toContain('/api/users/u1/entitlements/ent-2')
      expect(init.method).toBe('PATCH')
      const body = typeof init.body === 'string' ? JSON.parse(init.body) : null
      expect(body).toMatchObject({ bytes: 4096, expiresAt: null })
    })

    it('revokes a user quota entitlement (resolves on 204)', async () => {
      vi.mocked(fetch).mockResolvedValueOnce(makeResponse(null, true, 204))

      await expect(revokeUserEntitlement('u1', 'ent-2')).resolves.toBeUndefined()

      const [url, init] = vi.mocked(fetch).mock.calls[0] as [string, RequestInit]
      expect(url).toContain('/api/users/u1/entitlements/ent-2')
      expect(init.method).toBe('DELETE')
    })

    it('throws on entitlement error response', async () => {
      vi.mocked(fetch).mockResolvedValueOnce(makeResponse({ error: 'not found' }, false, 404))

      await expect(listUserEntitlements('missing')).rejects.toThrow('not found')
    })
  })

  describe('listQuotas', () => {
    it('fetches quotas list', async () => {
      const payload = {
        items: [
          {
            orgId: 'org1',
            baseQuota: 1024,
            entitlementQuota: 0,
            quota: 1024,
            used: 512,
            baseTrafficQuota: 2048,
            entitlementTrafficQuota: 0,
            trafficQuota: 2048,
            trafficUsed: 256,
            trafficPeriod: '2026-05',
            storagePlanName: null,
            storageExtraNames: [],
            trafficPlanName: null,
            trafficExtraNames: [],
          },
        ],
        total: 1,
      }
      vi.mocked(fetch).mockResolvedValueOnce(makeResponse(payload))

      const result = await listQuotas()

      expect(result).toEqual(payload)
      const [url] = vi.mocked(fetch).mock.calls[0] as [string]
      expect(url).toContain('/api/quotas')
    })

    it('throws on error response', async () => {
      vi.mocked(fetch).mockResolvedValueOnce(makeResponse({ error: 'forbidden' }, false, 403))

      await expect(listQuotas()).rejects.toThrow('forbidden')
    })
  })

  describe('getUserQuotaById', () => {
    it('fetches a single user quota from the user sub-resource', async () => {
      const payload = { used: 512, total: 1024, hasPersonalOrg: true }
      vi.mocked(fetch).mockResolvedValueOnce(makeResponse(payload))

      const result = await getUserQuotaById('u1')

      expect(result).toEqual(payload)
      const [url] = vi.mocked(fetch).mock.calls[0] as [string]
      expect(url).toContain('/api/users/u1/quota')
    })

    it('throws on error response', async () => {
      vi.mocked(fetch).mockResolvedValueOnce(makeResponse({ error: 'forbidden' }, false, 403))

      await expect(getUserQuotaById('u1')).rejects.toThrow('forbidden')
    })
  })

  describe('teams', () => {
    it('lists teams', async () => {
      const payload = { items: [{ id: 'team-1', name: 'Alpha' }], total: 1 }
      vi.mocked(fetch).mockResolvedValueOnce(makeResponse(payload))

      const result = await listTeams()

      expect(result).toEqual(payload)
      const [url] = vi.mocked(fetch).mock.calls[0] as [string]
      expect(url).toContain('/api/teams')
    })

    it('gets a team detail', async () => {
      const payload = { id: 'team-1', name: 'Alpha', quotaTotal: 20971520 }
      vi.mocked(fetch).mockResolvedValueOnce(makeResponse(payload))

      const result = await getTeam('team-1')

      expect(result).toEqual(payload)
      const [url] = vi.mocked(fetch).mock.calls[0] as [string]
      expect(url).toContain('/api/teams/team-1')
    })

    it('throws on error response', async () => {
      vi.mocked(fetch).mockResolvedValueOnce(makeResponse({ error: 'not found' }, false, 404))

      await expect(getTeam('missing')).rejects.toThrow('not found')
    })
  })

  describe('org entitlements', () => {
    it('lists entitlements for an org', async () => {
      const payload = { orgId: 'team-1', items: [] }
      vi.mocked(fetch).mockResolvedValueOnce(makeResponse(payload))

      const result = await listOrgEntitlements('team-1')

      expect(result).toEqual(payload)
      const [url] = vi.mocked(fetch).mock.calls[0] as [string]
      expect(url).toContain('/api/teams/team-1/entitlements')
    })

    it('grants an entitlement to an org', async () => {
      const payload = { orgId: 'team-1', entitlement: { id: 'ent-1', bytes: 1024 } }
      vi.mocked(fetch).mockResolvedValueOnce(makeResponse(payload))

      const result = await grantOrgEntitlement('team-1', { resourceType: 'storage', bytes: 1024, note: 'starter' })

      expect(result).toEqual(payload)
      const [url, init] = vi.mocked(fetch).mock.calls[0] as [string, RequestInit]
      expect(url).toContain('/api/teams/team-1/entitlements')
      expect(init.method).toBe('POST')
      const body = typeof init.body === 'string' ? JSON.parse(init.body) : null
      expect(body).toMatchObject({ resourceType: 'storage', bytes: 1024, note: 'starter' })
    })

    it('updates an org entitlement', async () => {
      const payload = { orgId: 'team-1', entitlement: { id: 'ent-1', bytes: 4096 } }
      vi.mocked(fetch).mockResolvedValueOnce(makeResponse(payload))

      const result = await updateOrgEntitlement('team-1', 'ent-1', { bytes: 4096 })

      expect(result).toEqual(payload)
      const [url, init] = vi.mocked(fetch).mock.calls[0] as [string, RequestInit]
      expect(url).toContain('/api/teams/team-1/entitlements/ent-1')
      expect(init.method).toBe('PATCH')
      const body = typeof init.body === 'string' ? JSON.parse(init.body) : null
      expect(body).toMatchObject({ bytes: 4096 })
    })

    it('revokes an org entitlement (resolves on 204)', async () => {
      vi.mocked(fetch).mockResolvedValueOnce(makeResponse(null, true, 204))

      await expect(revokeOrgEntitlement('team-1', 'ent-1')).resolves.toBeUndefined()

      const [url, init] = vi.mocked(fetch).mock.calls[0] as [string, RequestInit]
      expect(url).toContain('/api/teams/team-1/entitlements/ent-1')
      expect(init.method).toBe('DELETE')
    })

    it('throws on error response', async () => {
      vi.mocked(fetch).mockResolvedValueOnce(makeResponse({ error: 'not found' }, false, 404))

      await expect(listOrgEntitlements('missing')).rejects.toThrow('not found')
    })
  })

  describe('getUserQuota', () => {
    it('fetches the current user quota', async () => {
      const payload = {
        orgId: 'org1',
        baseQuota: 1024,
        entitlementQuota: 0,
        quota: 1024,
        used: 256,
        baseTrafficQuota: 2048,
        entitlementTrafficQuota: 0,
        trafficQuota: 2048,
        trafficUsed: 512,
        trafficPeriod: '2026-05',
        storagePlanName: null,
        storageExtraNames: [],
        trafficPlanName: null,
        trafficExtraNames: [],
      }
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
      expect(url).toContain('/api/site/options')
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
      expect(url).toContain('/api/site/options/site_name')
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
      expect(url).toContain('/api/site/options/site_name')
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
      expect(init.signal).toBeInstanceOf(AbortSignal)
    })

    it('throws ApiError when response is not ok', async () => {
      vi.mocked(fetch).mockResolvedValueOnce(makeResponse({ error: 'unauthorized' }, false, 401))

      const promise = getSession()

      await expect(promise).rejects.toMatchObject({ name: 'ApiError', status: 401 })
    })

    it('aborts and throws when the session request times out', async () => {
      vi.useFakeTimers()
      vi.mocked(fetch).mockImplementationOnce(
        (_url, init) =>
          new Promise((_resolve, reject) => {
            init?.signal?.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')))
          }),
      )

      const promise = getSession()
      const assertion = expect(promise).rejects.toThrow('Session request timed out')
      await vi.advanceTimersByTimeAsync(10_000)

      await assertion
      vi.useRealTimers()
    })

    it('shares one in-flight request across concurrent callers', async () => {
      const session = { session: { id: 'sess1' }, user: { id: 'u1' } }
      let resolveFetch: (res: Response) => void = () => {}
      vi.mocked(fetch).mockImplementationOnce(
        () =>
          new Promise<Response>((resolve) => {
            resolveFetch = resolve
          }),
      )

      const first = getSession()
      const second = getSession()
      resolveFetch(makeResponse(session))

      expect(await first).toEqual(session)
      expect(await second).toEqual(session)
      expect(vi.mocked(fetch)).toHaveBeenCalledTimes(1)
    })

    it('serves a resolved session from cache within the TTL and refetches after it', async () => {
      vi.useFakeTimers()
      const session = { session: { id: 'sess1' }, user: { id: 'u1' } }
      vi.mocked(fetch).mockResolvedValue(makeResponse(session))

      await getSession()
      await getSession()
      expect(vi.mocked(fetch)).toHaveBeenCalledTimes(1)

      await vi.advanceTimersByTimeAsync(5_001)
      await getSession()
      expect(vi.mocked(fetch)).toHaveBeenCalledTimes(2)
      vi.useRealTimers()
    })

    it('keeps sharing a slow in-flight request past the TTL instead of piling up duplicates', async () => {
      vi.useFakeTimers()
      const session = { session: { id: 'sess1' }, user: { id: 'u1' } }
      let resolveFetch: (res: Response) => void = () => {}
      vi.mocked(fetch).mockImplementationOnce(
        () =>
          new Promise<Response>((resolve) => {
            resolveFetch = resolve
          }),
      )

      const first = getSession()
      await vi.advanceTimersByTimeAsync(6_000)
      const second = getSession()
      resolveFetch(makeResponse(session))

      expect(await first).toEqual(session)
      expect(await second).toEqual(session)
      expect(vi.mocked(fetch)).toHaveBeenCalledTimes(1)
      vi.useRealTimers()
    })

    it('does not cache failures — the next call retries', async () => {
      vi.mocked(fetch)
        .mockResolvedValueOnce(makeResponse({ error: 'unavailable' }, false, 503))
        .mockResolvedValueOnce(makeResponse({ session: { id: 'sess1' }, user: { id: 'u1' } }))

      await expect(getSession()).rejects.toMatchObject({ name: 'ApiError', status: 503 })

      const result = await getSession()
      expect(result).toEqual({ session: { id: 'sess1' }, user: { id: 'u1' } })
      expect(vi.mocked(fetch)).toHaveBeenCalledTimes(2)
    })
  })

  describe('listAuthProviders', () => {
    it('fetches auth providers list from /api/site/auth-providers', async () => {
      const payload = {
        items: [{ providerId: 'github', type: 'oauth', name: 'GitHub', icon: '' }],
        callbackBaseUri: 'https://files.example',
      }
      vi.mocked(fetch).mockResolvedValueOnce(makeResponse(payload))

      const result = await listAuthProviders()

      expect(result).toEqual(payload)
      const [url] = vi.mocked(fetch).mock.calls[0] as [string]
      expect(url).toContain('/api/site/auth-providers')
    })

    it('returns items array with expected provider shape', async () => {
      const provider = { providerId: 'google', type: 'oauth', name: 'Google', icon: 'google-icon' }
      vi.mocked(fetch).mockResolvedValueOnce(
        makeResponse({ items: [provider], callbackBaseUri: 'https://files.example' }),
      )

      const result = await listAuthProviders()

      expect(result.items).toHaveLength(1)
      expect(result.items[0].providerId).toBe('google')
      expect(result.items[0].name).toBe('Google')
      expect(result.items[0].type).toBe('oauth')
      expect(result.items[0].icon).toBe('google-icon')
    })

    it('returns empty items array when no providers are configured', async () => {
      vi.mocked(fetch).mockResolvedValueOnce(makeResponse({ items: [], callbackBaseUri: 'https://files.example' }))

      const result = await listAuthProviders()

      expect(result.items).toHaveLength(0)
      expect(result.callbackBaseUri).toBe('https://files.example')
    })

    it('throws on error response', async () => {
      vi.mocked(fetch).mockResolvedValueOnce(makeResponse({ error: 'forbidden' }, false, 403))

      await expect(listAuthProviders()).rejects.toThrow('forbidden')
    })

    it('passes credentials: include', async () => {
      vi.mocked(fetch).mockResolvedValueOnce(makeResponse({ items: [], callbackBaseUri: 'https://files.example' }))

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
      expect(url).toContain('/api/users/alice')
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
      const payload = { items: [], total: 0, page: 1, pageSize: 20 }
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
      const payload = { items: [], total: 5, page: 2, pageSize: 10 }
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

  describe('announcements api', () => {
    const announcement = {
      id: 'ann-1',
      title: 'Maintenance',
      body: 'Short outage',
      status: 'published',
      priority: 1,
      publishedAt: '2026-05-01T00:00:00.000Z',
      createdBy: 'user-1',
      createdAt: '2026-05-01T00:00:00.000Z',
      updatedAt: '2026-05-01T00:00:00.000Z',
    }

    const input = {
      title: 'Maintenance',
      body: 'Short outage',
      status: 'published' as const,
      priority: 1,
    }

    it('lists announcement history', async () => {
      const payload = { items: [announcement], total: 1, page: 1, pageSize: 20 }
      vi.mocked(fetch).mockResolvedValueOnce(makeResponse(payload))

      const result = await listAnnouncements()

      expect(result).toEqual(payload)
      const [url] = vi.mocked(fetch).mock.calls[0] as [string]
      expect(url).toContain('/api/site/announcements')
      expect(url).toContain('page=1')
      expect(url).toContain('pageSize=20')
    })

    it('throws ApiError when announcement history fails', async () => {
      vi.mocked(fetch).mockResolvedValueOnce(makeResponse({ error: 'Cannot list announcements' }, false, 500))

      await expect(listAnnouncements()).rejects.toThrow('Cannot list announcements')
    })

    it('lists active announcements with scope query', async () => {
      const payload = { items: [announcement], total: 1, page: 1, pageSize: 20 }
      vi.mocked(fetch).mockResolvedValueOnce(makeResponse(payload))

      await listActiveAnnouncements()

      const [url] = vi.mocked(fetch).mock.calls[0] as [string]
      expect(url).toContain('/api/site/announcements')
      expect(url).toContain('scope=active')
    })

    it('throws ApiError when active announcements fail', async () => {
      vi.mocked(fetch).mockResolvedValueOnce(makeResponse({ error: 'Cannot list active announcements' }, false, 500))

      await expect(listActiveAnnouncements()).rejects.toThrow('Cannot list active announcements')
    })

    it('lists admin announcements with status filter', async () => {
      const payload = { items: [announcement], total: 1, page: 1, pageSize: 20 }
      vi.mocked(fetch).mockResolvedValueOnce(makeResponse(payload))

      await listAdminAnnouncements(1, 20, 'published')

      const [url] = vi.mocked(fetch).mock.calls[0] as [string]
      expect(url).toContain('/api/site/announcements')
      expect(url).toContain('scope=all')
      expect(url).toContain('status=published')
    })

    it('throws ApiError when admin announcement list fails', async () => {
      vi.mocked(fetch).mockResolvedValueOnce(makeResponse({ error: 'Forbidden' }, false, 403))

      await expect(listAdminAnnouncements()).rejects.toThrow('Forbidden')
    })

    it('creates an announcement', async () => {
      vi.mocked(fetch).mockResolvedValueOnce(makeResponse(announcement))

      const result = await createAnnouncement(input)

      expect(result).toEqual(announcement)
      const [url, init] = vi.mocked(fetch).mock.calls[0] as [string, RequestInit]
      expect(url).toBe('/api/site/announcements')
      expect(init.method).toBe('POST')
      expect(JSON.parse(init.body as string)).toEqual(input)
    })

    it('gets an announcement', async () => {
      vi.mocked(fetch).mockResolvedValueOnce(makeResponse(announcement))

      await getAnnouncement('ann-1')

      const [url, init] = vi.mocked(fetch).mock.calls[0] as [string, RequestInit]
      expect(url).toBe('/api/site/announcements/ann-1')
      expect(init.method).toBe('GET')
    })

    it('throws ApiError when getting an announcement fails', async () => {
      vi.mocked(fetch).mockResolvedValueOnce(makeResponse({ error: 'Announcement not found' }, false, 404))

      await expect(getAnnouncement('missing')).rejects.toThrow('Announcement not found')
    })

    it('updates an announcement', async () => {
      vi.mocked(fetch).mockResolvedValueOnce(makeResponse(announcement))

      await updateAnnouncement('ann-1', input)

      const [url, init] = vi.mocked(fetch).mock.calls[0] as [string, RequestInit]
      expect(url).toBe('/api/site/announcements/ann-1')
      expect(init.method).toBe('PUT')
      expect(JSON.parse(init.body as string)).toEqual(input)
    })

    it('throws ApiError when updating an announcement fails', async () => {
      vi.mocked(fetch).mockResolvedValueOnce(makeResponse({ error: 'Invalid announcement' }, false, 400))

      await expect(updateAnnouncement('ann-1', input)).rejects.toThrow('Invalid announcement')
    })

    it('deletes an announcement (resolves on 204)', async () => {
      vi.mocked(fetch).mockResolvedValueOnce(makeResponse(null, true, 204))

      await expect(deleteAnnouncement('ann-1')).resolves.toBeUndefined()

      const [url, init] = vi.mocked(fetch).mock.calls[0] as [string, RequestInit]
      expect(url).toBe('/api/site/announcements/ann-1')
      expect(init.method).toBe('DELETE')
    })

    it('throws ApiError when deleting an announcement fails', async () => {
      vi.mocked(fetch).mockResolvedValueOnce(makeResponse({ error: 'Announcement not found' }, false, 404))

      await expect(deleteAnnouncement('missing')).rejects.toThrow('Announcement not found')
    })

    it('throws ApiError for failed create', async () => {
      vi.mocked(fetch).mockResolvedValueOnce(makeResponse({ error: 'Invalid announcement' }, false, 400))

      await expect(createAnnouncement(input)).rejects.toThrow('Invalid announcement')
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

  describe('listReceivedShares', () => {
    it('calls /api/shares with box=received', async () => {
      const payload = { items: [], total: 0, page: 1, pageSize: 20 }
      vi.mocked(fetch).mockResolvedValueOnce(makeResponse(payload))

      const result = await listReceivedShares()

      expect(result).toEqual(payload)
      const [url] = vi.mocked(fetch).mock.calls[0] as [string]
      expect(url).toContain('/api/shares')
      expect(url).toContain('box=received')
    })

    it('throws on error response', async () => {
      vi.mocked(fetch).mockResolvedValueOnce(makeResponse({ error: 'unauthorized' }, false, 401))

      await expect(listReceivedShares()).rejects.toThrow('unauthorized')
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

  describe('revokeShare', () => {
    it('puts status: revoked to /api/shares/:token/status and resolves with the revoked share', async () => {
      const payload = { token: 'tok123', status: 'revoked', kind: 'landing' }
      vi.mocked(fetch).mockResolvedValueOnce(makeResponse(payload))

      const result = await revokeShare('tok123')

      expect(result).toEqual(payload)
      const [url, init] = vi.mocked(fetch).mock.calls[0] as [string, RequestInit]
      expect(url).toContain('/api/shares/tok123/status')
      expect(init.method).toBe('PUT')
      const body = typeof init.body === 'string' ? JSON.parse(init.body) : null
      expect(body).toEqual({ status: 'revoked' })
    })

    it('throws ApiError on non-ok response', async () => {
      vi.mocked(fetch).mockResolvedValueOnce(makeResponse({ error: 'Forbidden' }, false, 403))

      await expect(revokeShare('tok123')).rejects.toThrow('Forbidden')
      vi.mocked(fetch).mockResolvedValueOnce(makeResponse({ error: 'Forbidden' }, false, 403))
      await expect(revokeShare('tok123')).rejects.toBeInstanceOf(ApiError)
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

    it('throws ApiError with QUOTA_EXCEEDED reason on 400', async () => {
      vi.mocked(fetch).mockResolvedValueOnce(
        makeResponse(
          {
            error: {
              code: 400,
              message: 'Quota exceeded',
              status: 'FAILED_PRECONDITION',
              details: [
                {
                  '@type': 'type.googleapis.com/google.rpc.ErrorInfo',
                  reason: 'QUOTA_EXCEEDED',
                  domain: 'zpan.dev',
                },
              ],
            },
          },
          false,
          400,
        ),
      )

      await expect(saveShareToDrive('tok123', { targetOrgId: 'org-1', targetParent: '' })).rejects.toMatchObject({
        name: 'ApiError',
        status: 400,
        reason: 'QUOTA_EXCEEDED',
      })
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
    it('calls GET /api/image-hosting/config and returns config when enabled', async () => {
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
      expect(url).toContain('/api/image-hosting/config')
    })

    it('returns the disabled shape when feature is not enabled', async () => {
      const disabled = {
        enabled: false,
        customDomain: null,
        domainVerifiedAt: null,
        domainStatus: 'none',
        dnsInstructions: null,
        refererAllowlist: null,
        createdAt: null,
      }
      vi.mocked(fetch).mockResolvedValueOnce(makeResponse(disabled))

      const result = await getIhostConfig()

      expect(result).toEqual(disabled)
      expect(result.enabled).toBe(false)
    })

    it('passes credentials: include', async () => {
      vi.mocked(fetch).mockResolvedValueOnce(makeResponse({ enabled: false }))

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
    it('calls PUT /api/image-hosting/config with enabled: true and returns config', async () => {
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
      expect(url).toContain('/api/image-hosting/config')
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
      expect(url).toContain('/api/image-hosting/config')
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
    it('sends DELETE to /api/image-hosting/config', async () => {
      vi.mocked(fetch).mockResolvedValueOnce(makeResponse(null, true, 204))

      await deleteIhostConfig()

      const [url, init] = vi.mocked(fetch).mock.calls[0] as [string, RequestInit]
      expect(url).toContain('/api/image-hosting/config')
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
      permissions: { ihost: ['upload'] },
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

    it('filters to ihost:upload permission only', async () => {
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
      permissions: { ihost: ['upload'] },
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
      expect(body.configId).toBe('ihost')
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
      expect(body.configId).toBe('ihost')
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

  describe('WebDAV app passwords', () => {
    const samplePassword = {
      id: 'webdav-key-1',
      name: 'Finder',
      start: 'zpan',
      prefix: null,
      createdAt: '2024-01-01T00:00:00.000Z',
      lastRequest: null,
      permissions: { webdav: ['read', 'write'] },
      referenceId: 'user-1',
      enabled: true,
    }

    it('lists only webdav app passwords', async () => {
      vi.mocked(fetch).mockResolvedValueOnce(
        makeResponse({
          apiKeys: [samplePassword, { ...samplePassword, id: 'other', permissions: { other: ['read'] } }],
        }),
      )

      const result = await listWebDavAppPasswords()

      expect(result).toEqual([samplePassword])
      const [url, init] = vi.mocked(fetch).mock.calls[0] as [string, RequestInit]
      expect(url).toBe('/api/auth/api-key/list?configId=webdav')
      expect(init.method).toBe('GET')
    })

    it('creates a webdav app password with configId', async () => {
      const created = { ...samplePassword, key: 'webdav-secret' }
      vi.mocked(fetch).mockResolvedValueOnce(makeResponse(created))

      const result = await createWebDavAppPassword('Finder')

      expect(result).toEqual(created)
      const [url, init] = vi.mocked(fetch).mock.calls[0] as [string, RequestInit]
      expect(url).toBe('/api/auth/api-key/create')
      expect(init.method).toBe('POST')
      expect(JSON.parse(init.body as string)).toEqual({ configId: 'webdav', name: 'Finder' })
    })

    it('revokes a webdav app password with configId', async () => {
      vi.mocked(fetch).mockResolvedValueOnce(makeResponse({ success: true }))

      const result = await revokeWebDavAppPassword('webdav-key-1')

      expect(result).toEqual({ success: true })
      const [url, init] = vi.mocked(fetch).mock.calls[0] as [string, RequestInit]
      expect(url).toBe('/api/auth/api-key/delete')
      expect(init.method).toBe('POST')
      expect(JSON.parse(init.body as string)).toEqual({ configId: 'webdav', keyId: 'webdav-key-1' })
    })

    it('throws ApiError on webdav app password failure', async () => {
      vi.mocked(fetch).mockResolvedValueOnce(makeResponse({ error: 'Unauthorized' }, false, 401))

      await expect(listWebDavAppPasswords()).rejects.toThrow('Unauthorized')
    })
  })

  describe('Remote download API keys', () => {
    const sampleKey = {
      id: 'remote-key-1',
      name: 'Remote Download',
      start: 'zpan',
      prefix: null,
      createdAt: '2024-01-01T00:00:00.000Z',
      lastRequest: null,
      permissions: { remoteDownload: ['read', 'create', 'cancel'] },
      referenceId: 'org-1',
      enabled: true,
    }

    it('lists only remote-download API keys', async () => {
      vi.mocked(fetch).mockResolvedValueOnce(
        makeResponse({
          apiKeys: [sampleKey, { ...sampleKey, id: 'other', permissions: { ihost: ['upload'] } }],
        }),
      )

      const result = await listRemoteDownloadApiKeys('org-1')

      expect(result).toEqual([sampleKey])
      const [url, init] = vi.mocked(fetch).mock.calls[0] as [string, RequestInit]
      expect(url).toBe('/api/auth/api-key/list?organizationId=org-1&configId=remote-download')
      expect(init.method).toBe('GET')
    })

    it('creates a remote-download API key with configId', async () => {
      const created = { ...sampleKey, key: 'remote-secret' }
      vi.mocked(fetch).mockResolvedValueOnce(makeResponse(created))

      const result = await createRemoteDownloadApiKey('org-1', 'Remote Download')

      expect(result).toEqual(created)
      const [url, init] = vi.mocked(fetch).mock.calls[0] as [string, RequestInit]
      expect(url).toBe('/api/auth/api-key/create')
      expect(init.method).toBe('POST')
      expect(JSON.parse(init.body as string)).toEqual({
        configId: 'remote-download',
        name: 'Remote Download',
        organizationId: 'org-1',
      })
    })

    it('revokes a remote-download API key with configId', async () => {
      vi.mocked(fetch).mockResolvedValueOnce(makeResponse({ success: true }))

      const result = await revokeRemoteDownloadApiKey('remote-key-1')

      expect(result).toEqual({ success: true })
      const [url, init] = vi.mocked(fetch).mock.calls[0] as [string, RequestInit]
      expect(url).toBe('/api/auth/api-key/delete')
      expect(init.method).toBe('POST')
      expect(JSON.parse(init.body as string)).toEqual({ configId: 'remote-download', keyId: 'remote-key-1' })
    })

    it('throws ApiError on remote-download API key failure', async () => {
      vi.mocked(fetch).mockResolvedValueOnce(makeResponse({ error: 'Unauthorized' }, false, 401))

      await expect(listRemoteDownloadApiKeys('org-1')).rejects.toThrow('Unauthorized')
    })
  })

  describe('listIhostImages', () => {
    it('calls GET /api/image-hosting/images', async () => {
      vi.mocked(fetch).mockResolvedValueOnce(makeResponse({ items: [], nextCursor: null }))

      await listIhostImages()

      const [url] = vi.mocked(fetch).mock.calls[0] as [string, RequestInit]
      expect(url).toContain('/api/image-hosting/images')
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
    it('calls POST /api/image-hosting/images/presign with JSON body', async () => {
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
      expect(url).toContain('/api/image-hosting/images/presign')
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
    it('calls PUT /api/image-hosting/images/:id/status', async () => {
      const image = { id: 'img-1', status: 'active' }
      vi.mocked(fetch).mockResolvedValueOnce(makeResponse(image))

      await confirmIhostImage('img-1')

      const [url, init] = vi.mocked(fetch).mock.calls[0] as [string, RequestInit]
      expect(url).toBe('/api/image-hosting/images/img-1/status')
      expect(init.method).toBe('PUT')
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
    it('calls DELETE /api/image-hosting/images/:id', async () => {
      vi.mocked(fetch).mockResolvedValueOnce({ ok: true, status: 204, json: async () => null } as unknown as Response)

      await deleteIhostImage('img-1')

      const [url, init] = vi.mocked(fetch).mock.calls[0] as [string, RequestInit]
      expect(url).toContain('/api/image-hosting/images/img-1')
      expect(init.method).toBe('DELETE')
    })

    it('throws ApiError on failure', async () => {
      vi.mocked(fetch).mockResolvedValueOnce(makeResponse({ error: 'Not found' }, false, 404))

      await expect(deleteIhostImage('bad-id')).rejects.toThrow()
    })
  })

  describe('uploadAvatar', () => {
    it('PUTs multipart/form-data to /api/users/me/avatar with file field', async () => {
      vi.mocked(fetch).mockResolvedValueOnce(makeResponse({ url: 'https://example.com/a.png' }, true, 200))
      const file = new File(['x'], 'a.png', { type: 'image/png' })

      await uploadAvatar(file)

      const [url, init] = vi.mocked(fetch).mock.calls[0] as [string, RequestInit]
      expect(url).toBe('/api/users/me/avatar')
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
    it('DELETEs /api/users/me/avatar', async () => {
      vi.mocked(fetch).mockResolvedValueOnce(makeResponse({ ok: true }, true, 200))
      await deleteAvatar()

      const [url, init] = vi.mocked(fetch).mock.calls[0] as [string, RequestInit]
      expect(url).toContain('/api/users/me/avatar')
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
      expect(url).toContain('/api/site/licensing/status')
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

  describe('getInstanceInfo', () => {
    const instance = {
      id: 'inst-123',
      name: 'My ZPan',
      url: 'https://files.example.com',
      version: '2.5.0',
      runtime: 'node',
      platform: 'docker',
      server: { os: { platform: 'linux', arch: 'x64', release: '6.1.0' } },
      node: { version: 'v24.0.0' },
    }

    it('calls the correct endpoint', async () => {
      vi.mocked(fetch).mockResolvedValueOnce(makeResponse(instance))

      await getInstanceInfo()

      const [url, init] = vi.mocked(fetch).mock.calls[0] as [string, RequestInit]
      expect(url).toContain('/api/site/instance')
      expect(init?.method ?? 'GET').toBe('GET')
    })

    it('returns the instance info', async () => {
      vi.mocked(fetch).mockResolvedValueOnce(makeResponse(instance))

      const result = await getInstanceInfo()

      expect(result).toEqual(instance)
    })

    it('throws ApiError on failure', async () => {
      vi.mocked(fetch).mockResolvedValueOnce(makeResponse({ error: 'Forbidden' }, false, 403))

      await expect(getInstanceInfo()).rejects.toThrow()
    })
  })

  describe('getChangelog', () => {
    const changelog = {
      currentVersion: '2.7.2',
      latestVersion: '2.8.0',
      updateAvailable: true,
      markdown: '## [2.8.0]\n- new stuff',
    }

    it('calls the correct endpoint', async () => {
      vi.mocked(fetch).mockResolvedValueOnce(makeResponse(changelog))

      await getChangelog()

      const [url, init] = vi.mocked(fetch).mock.calls[0] as [string, RequestInit]
      expect(url).toContain('/api/site/changelog')
      expect(init?.method ?? 'GET').toBe('GET')
    })

    it('returns the changelog payload', async () => {
      vi.mocked(fetch).mockResolvedValueOnce(makeResponse(changelog))

      const result = await getChangelog()

      expect(result).toEqual(changelog)
    })

    it('appends refresh=true to bypass the server cache', async () => {
      vi.mocked(fetch).mockResolvedValueOnce(makeResponse(changelog))

      await getChangelog({ refresh: true })

      const [url] = vi.mocked(fetch).mock.calls[0] as [string, RequestInit]
      expect(url).toContain('/api/site/changelog')
      expect(url).toContain('refresh=true')
    })

    it('throws ApiError on failure', async () => {
      vi.mocked(fetch).mockResolvedValueOnce(makeResponse({ error: 'Forbidden' }, false, 403))

      await expect(getChangelog()).rejects.toThrow()
    })
  })

  describe('connectCloud', () => {
    it('calls the correct endpoint with POST', async () => {
      const payload = {
        code: 'ABC-123',
        pairingUrl: 'https://cloud.zpan.space/pair',
        expiresAt: '2026-01-01T00:00:00Z',
      }
      vi.mocked(fetch).mockResolvedValueOnce(makeResponse(payload))

      await connectCloud()

      const [url, init] = vi.mocked(fetch).mock.calls[0] as [string, RequestInit]
      expect(url).toContain('/api/site/licensing/pairings')
      expect(init.method).toBe('POST')
    })

    it('returns pairing info', async () => {
      const payload = {
        code: 'XYZ-789',
        pairingUrl: 'https://cloud.zpan.space/pair',
        expiresAt: '2026-01-01T00:00:00Z',
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
      expect(url).toContain('/api/site/licensing/pairings/ABC-123')
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
      expect(url).toContain('/api/site/licensing/refresh-runs')
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
      vi.mocked(fetch).mockResolvedValueOnce(makeResponse(null, true, 204))

      await disconnectCloud()

      const [url, init] = vi.mocked(fetch).mock.calls[0] as [string, RequestInit]
      expect(url).toContain('/api/site/licensing/binding')
      expect(init.method).toBe('DELETE')
    })

    it('resolves on 204', async () => {
      vi.mocked(fetch).mockResolvedValueOnce(makeResponse(null, true, 204))

      await expect(disconnectCloud()).resolves.toBeUndefined()
    })

    it('throws ApiError on failure', async () => {
      vi.mocked(fetch).mockResolvedValueOnce(makeResponse({ error: 'Forbidden' }, false, 403))

      await expect(disconnectCloud()).rejects.toThrow()
    })
  })

  describe('getBranding', () => {
    it('calls GET /api/site/branding and returns config', async () => {
      const payload = {
        logo_url: null,
        favicon_url: null,
        wordmark_text: null,
        hide_powered_by: false,
        theme: { mode: 'preset', preset: 'default', custom: null, configured: false },
      }
      vi.mocked(fetch).mockResolvedValueOnce(makeResponse(payload))

      const result = await getBranding()

      expect(result).toEqual(payload)
      const [url] = vi.mocked(fetch).mock.calls[0] as [string]
      expect(url).toContain('/api/site/branding')
    })

    it('resolves with stored branding values', async () => {
      const logoDataUri = 'data:image/svg+xml;base64,PHN2Zz48L3N2Zz4='
      const payload = {
        logo_url: logoDataUri,
        favicon_url: null,
        wordmark_text: 'MyCloud',
        hide_powered_by: true,
        theme: { mode: 'preset', preset: 'forest', custom: null, configured: true },
      }
      vi.mocked(fetch).mockResolvedValueOnce(makeResponse(payload))

      const result = await getBranding()

      expect(result.logo_url).toBe(logoDataUri)
      expect(result.wordmark_text).toBe('MyCloud')
      expect(result.hide_powered_by).toBe(true)
    })

    it('throws ApiError on non-ok response', async () => {
      vi.mocked(fetch).mockResolvedValueOnce(makeResponse({ error: 'Internal error' }, false, 500))

      await expect(getBranding()).rejects.toThrow('Internal error')
    })
  })

  describe('saveBranding', () => {
    it('sends PUT /api/site/branding as multipart', async () => {
      const payload = {
        logo_url: null,
        favicon_url: null,
        wordmark_text: 'MyCloud',
        hide_powered_by: false,
        theme: { mode: 'preset', preset: 'default', custom: null, configured: false },
      }
      vi.mocked(fetch).mockResolvedValueOnce(makeResponse(payload))

      await saveBranding({ wordmark_text: 'MyCloud' })

      const [url, init] = vi.mocked(fetch).mock.calls[0] as [string, RequestInit]
      expect(url).toContain('/api/site/branding')
      expect(init.method).toBe('PUT')
      expect(init.body).toBeInstanceOf(FormData)
    })

    it('includes theme fields in FormData when provided', async () => {
      const payload = {
        logo_url: null,
        favicon_url: null,
        wordmark_text: null,
        hide_powered_by: false,
        theme: {
          mode: 'custom',
          preset: 'rose',
          configured: true,
          custom: {
            primary_color: '#123456',
            primary_foreground: '#ffffff',
            canvas_color: '#f8fafc',
            sidebar_accent_color: '#ffe4e6',
            ring_color: '#0f172a',
          },
        },
      }
      vi.mocked(fetch).mockResolvedValueOnce(makeResponse(payload))

      await saveBranding({
        theme_mode: 'custom',
        theme_preset: 'rose',
        theme_custom: payload.theme.custom,
      })

      const [, init] = vi.mocked(fetch).mock.calls[0] as [string, RequestInit]
      const form = init.body as FormData
      expect(form.get('theme_mode')).toBe('custom')
      expect(form.get('theme_preset')).toBe('rose')
      expect(form.get('theme_primary_color')).toBe('#123456')
      expect(form.get('theme_primary_foreground')).toBe('#ffffff')
      expect(form.get('theme_canvas_color')).toBe('#f8fafc')
      expect(form.get('theme_sidebar_accent_color')).toBe('#ffe4e6')
      expect(form.get('theme_ring_color')).toBe('#0f172a')
    })

    it('includes only logo file fields in FormData when provided', async () => {
      const payload = {
        logo_url: 'data:image/png;base64,cG5nLWRhdGE=',
        favicon_url: null,
        wordmark_text: null,
        hide_powered_by: false,
        theme: { mode: 'preset', preset: 'default', custom: null, configured: false },
      }
      vi.mocked(fetch).mockResolvedValueOnce(makeResponse(payload))
      const file = new File(['png-data'], 'logo.png', { type: 'image/png' })

      await saveBranding({ logo: file })

      const [, init] = vi.mocked(fetch).mock.calls[0] as [string, RequestInit]
      const form = init.body as FormData
      expect(form.get('logo')).toBe(file)
      expect(form.get('theme_mode')).toBeNull()
      expect(form.get('theme_preset')).toBeNull()
      expect(form.get('theme_primary_color')).toBeNull()
      expect(form.get('theme_primary_foreground')).toBeNull()
      expect(form.get('theme_canvas_color')).toBeNull()
      expect(form.get('theme_sidebar_accent_color')).toBeNull()
      expect(form.get('theme_ring_color')).toBeNull()
    })

    it('throws ApiError on 402 (feature gated)', async () => {
      vi.mocked(fetch).mockResolvedValueOnce(
        makeResponse({ error: 'feature_not_available', feature: 'white_label' }, false, 402),
      )

      await expect(saveBranding({ wordmark_text: 'x' })).rejects.toThrow()
    })

    it('throws ApiError on 422 validation failure', async () => {
      vi.mocked(fetch).mockResolvedValueOnce(
        makeResponse({ error: 'theme_primary_color must be a CSS hex color' }, false, 422),
      )

      await expect(
        saveBranding({
          theme_mode: 'custom',
          theme_preset: 'default',
          theme_custom: {
            primary_color: 'blue',
            primary_foreground: '#ffffff',
            canvas_color: '#f8fafc',
            sidebar_accent_color: '#dbeafe',
            ring_color: '#0f172a',
          },
        }),
      ).rejects.toMatchObject({ status: 422 })
    })
  })

  describe('resetBrandingField', () => {
    it('sends DELETE /api/site/branding/:field', async () => {
      vi.mocked(fetch).mockResolvedValueOnce(makeResponse({ field: 'logo', reset: true }))

      await resetBrandingField('logo')

      const [url, init] = vi.mocked(fetch).mock.calls[0] as [string, RequestInit]
      expect(url).toContain('/api/site/branding/logo')
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
      expect(url).toContain('/api/site/email')
      expect(init.method).toBe('GET')
    })

    it('saveEmailConfig PUTs the expected payload', async () => {
      vi.mocked(fetch).mockResolvedValueOnce(makeResponse({ success: true }))

      const payload = { enabled: true, provider: 'cloudflare' as const, from: 'no-reply@zpan.space' }
      await saveEmailConfig(payload)

      const [url, init] = vi.mocked(fetch).mock.calls[0] as [string, RequestInit]
      expect(url).toContain('/api/site/email')
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
      expect(url).toContain('/api/site/email/test-messages')
      expect(init.method).toBe('POST')
      expect(init.body).toBe(JSON.stringify({ to: 'user@example.com' }))
    })

    it('testEmail throws ApiError on failure', async () => {
      vi.mocked(fetch).mockResolvedValueOnce(makeResponse({ error: 'send failed' }, false, 400))

      await expect(testEmail('user@example.com')).rejects.toThrow('send failed')
    })
  })

  describe('site stats API', () => {
    const dashboardPayload = {
      generatedAt: '2026-07-09T00:00:00.000Z',
      from: '2026-07-01T00:00:00.000Z',
      to: '2026-07-09T00:00:00.000Z',
    }
    const range = {
      from: '2026-07-01T00:00:00.000Z',
      to: '2026-07-09T00:00:00.000Z',
      timeZone: 'UTC' as const,
    }
    const dashboardEndpoints = [
      { name: 'getAdminDashboardOverviewStats', path: '/api/site/stats/overview', fn: getAdminDashboardOverviewStats },
      {
        name: 'getAdminDashboardOperationsStats',
        path: '/api/site/stats/operations',
        fn: getAdminDashboardOperationsStats,
      },
      { name: 'getAdminDashboardGrowthStats', path: '/api/site/stats/growth', fn: getAdminDashboardGrowthStats },
      { name: 'getAdminDashboardStorageStats', path: '/api/site/stats/storage', fn: getAdminDashboardStorageStats },
      { name: 'getAdminDashboardTrafficStats', path: '/api/site/stats/traffic', fn: getAdminDashboardTrafficStats },
      { name: 'getAdminDashboardSharingStats', path: '/api/site/stats/sharing', fn: getAdminDashboardSharingStats },
    ] as const

    for (const endpoint of dashboardEndpoints) {
      it(`${endpoint.name} fetches dashboard stats with from/to`, async () => {
        vi.mocked(fetch).mockResolvedValueOnce(makeResponse(dashboardPayload))

        const result = await endpoint.fn(range)

        expect(result).toEqual(dashboardPayload)
        const [url, init] = vi.mocked(fetch).mock.calls[0] as [string, RequestInit]
        expect(url).toContain(endpoint.path)
        expect(decodeURIComponent(url)).toContain(`from=${range.from}`)
        expect(decodeURIComponent(url)).toContain(`to=${range.to}`)
        expect(decodeURIComponent(url)).toContain(`timeZone=${range.timeZone}`)
        expect(init.method).toBe('GET')
      })

      it(`${endpoint.name} throws ApiError on failure`, async () => {
        vi.mocked(fetch).mockResolvedValueOnce(makeResponse({ error: 'Feature not available' }, false, 402))

        await expect(endpoint.fn(range)).rejects.toMatchObject({ status: 402 })
      })
    }
  })

  describe('listAdminAuditLogs', () => {
    const auditEvent = {
      id: 'evt-1',
      orgId: 'org-1',
      userId: 'user-1',
      action: 'upload',
      targetType: 'file',
      targetId: 'file-1',
      targetName: 'doc.pdf',
      metadata: null,
      createdAt: '2026-01-01T00:00:00.000Z',
      user: { id: 'user-1', name: 'Alice', image: null },
      orgName: 'Personal',
    }

    it('calls correct URL with defaults', async () => {
      vi.mocked(fetch).mockResolvedValueOnce(makeResponse({ items: [], total: 0, page: 1, pageSize: 20 }))

      await listAdminAuditLogs()

      const [url] = vi.mocked(fetch).mock.calls[0] as [string]
      expect(url).toContain('/api/site/audit-events')
      expect(url).toContain('page=1')
      expect(url).toContain('pageSize=20')
    })

    it('includes optional filters in query', async () => {
      vi.mocked(fetch).mockResolvedValueOnce(makeResponse({ items: [], total: 0, page: 1, pageSize: 20 }))

      await listAdminAuditLogs(2, 10, {
        orgId: 'org-1',
        userId: 'user-1',
        action: 'upload',
        targetType: 'file',
        createdFrom: '2026-01-01T00:00:00.000Z',
        createdTo: '2026-02-01T00:00:00.000Z',
      })

      const [url] = vi.mocked(fetch).mock.calls[0] as [string]
      expect(url).toContain('page=2')
      expect(url).toContain('pageSize=10')
      expect(url).toContain('orgId=org-1')
      expect(url).toContain('userId=user-1')
      expect(url).toContain('action=upload')
      expect(url).toContain('targetType=file')
      expect(url).toContain('createdFrom=2026-01-01T00%3A00%3A00.000Z')
      expect(url).toContain('createdTo=2026-02-01T00%3A00%3A00.000Z')
    })

    it('returns parsed paginated response', async () => {
      const payload = { items: [auditEvent], total: 1, page: 1, pageSize: 20 }
      vi.mocked(fetch).mockResolvedValueOnce(makeResponse(payload))

      const result = await listAdminAuditLogs()

      expect(result).toEqual(payload)
    })

    it('throws ApiError on failed response', async () => {
      vi.mocked(fetch).mockResolvedValueOnce(makeResponse({ error: 'Forbidden' }, false, 403))

      await expect(listAdminAuditLogs()).rejects.toThrow('Forbidden')
    })

    it('throws ApiError with status 402 when feature unavailable', async () => {
      vi.mocked(fetch).mockResolvedValueOnce(
        makeResponse({ error: 'feature_not_available', feature: 'audit_log' }, false, 402),
      )

      await expect(listAdminAuditLogs()).rejects.toMatchObject({ status: 402 })
    })
  })

  describe('listObjectsByPath', () => {
    it('sends path and optional filters as query params', async () => {
      vi.mocked(fetch).mockResolvedValueOnce(makeResponse({ items: [], total: 0, page: 1, pageSize: 500 }))

      await listObjectsByPath('a/b', 2, 50, { type: 'dir', search: 'doc', orgId: 'org-1' })

      const [url, init] = vi.mocked(fetch).mock.calls[0] as [string, RequestInit]
      expect(url).toContain('/api/objects?')
      expect(url).toContain('path=a%2Fb')
      expect(url).toContain('page=2')
      expect(url).toContain('pageSize=50')
      expect(url).toContain('type=dir')
      expect(url).toContain('search=doc')
      expect(url).toContain('orgId=org-1')
      expect(init.method).toBe('GET')
    })

    it('omits absent optional filters', async () => {
      vi.mocked(fetch).mockResolvedValueOnce(makeResponse({ items: [], total: 0, page: 1, pageSize: 500 }))

      await listObjectsByPath('root')

      const [url] = vi.mocked(fetch).mock.calls[0] as [string]
      expect(url).not.toContain('type=')
      expect(url).not.toContain('search=')
      expect(url).not.toContain('orgId=')
    })

    it('throws ApiError on failure', async () => {
      vi.mocked(fetch).mockResolvedValueOnce(makeResponse({ error: 'forbidden' }, false, 403))

      await expect(listObjectsByPath('root')).rejects.toThrow('forbidden')
    })
  })

  describe('isNameConflictError', () => {
    const errorBody = (reason: string, metadata?: Record<string, string>) => ({
      error: {
        code: 409,
        message: 'Name already exists',
        status: 'ALREADY_EXISTS',
        details: [{ '@type': 'type.googleapis.com/google.rpc.ErrorInfo', reason, domain: 'zpan.dev', metadata }],
      },
    })

    it('returns true only for 409 NAME_CONFLICT ApiErrors', () => {
      const conflict = new ApiError(409, errorBody('NAME_CONFLICT', { conflictingName: 'a', conflictingId: 'id1' }))
      expect(isNameConflictError(conflict)).toBe(true)
      expect(conflict.metadata).toEqual({ conflictingName: 'a', conflictingId: 'id1' })
      expect(conflict.reason).toBe('NAME_CONFLICT')
    })

    it('returns false for other ApiErrors and non-errors', () => {
      expect(isNameConflictError(new ApiError(409, errorBody('OTHER')))).toBe(false)
      expect(isNameConflictError(new ApiError(404, errorBody('NAME_CONFLICT')))).toBe(false)
      expect(isNameConflictError(new Error('nope'))).toBe(false)
      expect(isNameConflictError(null)).toBe(false)
    })
  })

  describe('admin auth providers api', () => {
    it('upserts an auth provider', async () => {
      const data = { enabled: true, clientId: 'cid', clientSecret: 'secret' }
      vi.mocked(fetch).mockResolvedValueOnce(makeResponse({ providerId: 'google', ...data }))

      await upsertAuthProvider('google', data as never)

      const [url, init] = vi.mocked(fetch).mock.calls[0] as [string, RequestInit]
      expect(url).toBe('/api/site/auth-providers/google')
      expect(init.method).toBe('PUT')
      expect(init.body).toBe(JSON.stringify(data))
    })

    it('deletes an auth provider (resolves on 204)', async () => {
      vi.mocked(fetch).mockResolvedValueOnce(makeResponse(null, true, 204))

      await expect(deleteAuthProvider('google')).resolves.toBeUndefined()

      const [url, init] = vi.mocked(fetch).mock.calls[0] as [string, RequestInit]
      expect(url).toBe('/api/site/auth-providers/google')
      expect(init.method).toBe('DELETE')
    })

    it('throws ApiError on failure', async () => {
      vi.mocked(fetch).mockResolvedValueOnce(makeResponse({ error: 'forbidden' }, false, 403))

      await expect(upsertAuthProvider('google', {} as never)).rejects.toThrow('forbidden')
    })
  })

  describe('invite codes api', () => {
    it('lists invite codes with pagination', async () => {
      vi.mocked(fetch).mockResolvedValueOnce(makeResponse({ items: [], total: 0 }))

      await listInviteCodes(3, 25)

      const [url, init] = vi.mocked(fetch).mock.calls[0] as [string, RequestInit]
      expect(url).toContain('/api/site/invite-codes?')
      expect(url).toContain('page=3')
      expect(url).toContain('pageSize=25')
      expect(init.method).toBe('GET')
    })

    it('generates invite codes with count only', async () => {
      vi.mocked(fetch).mockResolvedValueOnce(makeResponse({ codes: [] }))

      await generateInviteCodes(5)

      const [url, init] = vi.mocked(fetch).mock.calls[0] as [string, RequestInit]
      expect(url).toBe('/api/site/invite-codes')
      expect(init.method).toBe('POST')
      expect(init.body).toBe(JSON.stringify({ count: 5 }))
    })

    it('includes expiresInDays when provided', async () => {
      vi.mocked(fetch).mockResolvedValueOnce(makeResponse({ codes: [] }))

      await generateInviteCodes(2, 7)

      const [, init] = vi.mocked(fetch).mock.calls[0] as [string, RequestInit]
      expect(init.body).toBe(JSON.stringify({ count: 2, expiresInDays: 7 }))
    })

    it('deletes an invite code (resolves on 204)', async () => {
      vi.mocked(fetch).mockResolvedValueOnce(makeResponse(null, true, 204))

      await expect(deleteInviteCode('code-1')).resolves.toBeUndefined()

      const [url, init] = vi.mocked(fetch).mock.calls[0] as [string, RequestInit]
      expect(url).toBe('/api/site/invite-codes/code-1')
      expect(init.method).toBe('DELETE')
    })

    it('throws ApiError on failure', async () => {
      vi.mocked(fetch).mockResolvedValueOnce(makeResponse({ error: 'forbidden' }, false, 403))

      await expect(generateInviteCodes(1)).rejects.toThrow('forbidden')
    })
  })

  describe('listTeamActivities', () => {
    it('fetches team activity with pagination', async () => {
      vi.mocked(fetch).mockResolvedValueOnce(makeResponse({ items: [], total: 0, page: 1, pageSize: 20 }))

      await listTeamActivities('team-1', 2, 15)

      const [url, init] = vi.mocked(fetch).mock.calls[0] as [string, RequestInit]
      expect(url).toContain('/api/teams/team-1/activity?')
      expect(url).toContain('page=2')
      expect(url).toContain('pageSize=15')
      expect(init.method).toBe('GET')
    })

    it('throws ApiError on failure', async () => {
      vi.mocked(fetch).mockResolvedValueOnce(makeResponse({ error: 'forbidden' }, false, 403))

      await expect(listTeamActivities('team-1')).rejects.toThrow('forbidden')
    })
  })
})
