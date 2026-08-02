import type { CloudOrderQuotaChange } from '@shared/schemas'
import type { CloudStoreTarget } from '@shared/types'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  AppError,
  type CloudStoreBinding,
  type CloudStoreRepo,
  type EffectiveQuota,
  type LicensingCloudGateway,
  type QuotaRepo,
  type X402CapacityPurchaseIntent,
  type X402CapacityPurchaseRepo,
} from '../ports'

// Asserts a failed outcome carries the expected AppError (status / reason / message).
function expectError(
  out: { ok: boolean } & Record<string, unknown>,
  expected: { httpStatus: number; reason?: string; message: string },
) {
  expect(out.ok).toBe(false)
  const error = (out as unknown as { error: AppError }).error
  expect(error).toBeInstanceOf(AppError)
  expect(error.httpStatus).toBe(expected.httpStatus)
  expect(error.meta.reason).toBe(expected.reason)
  expect(error.message).toBe(expected.message)
}

import { verifyCloudEventToken } from '../site/licensing'
import {
  type CloudStoreDeps,
  cancelOrder,
  continueOrderPayment,
  createBillingPortalSession,
  createCheckout,
  getCreditBalance,
  getStoreReadiness,
  listCapacityOffers,
  listCreditProducts,
  listPackages,
  listTargets,
  processDeliveryWebhook,
  purchaseCapacity,
  redeemGiftCard,
} from './store'

// Token verification derives from a signed PASETO + trusted keys — out of scope
// for a usecase unit test. Mock it so each case chooses verified/invalid; the
// real path is covered by cloud-store.integration.test.ts.
vi.mock('../site/licensing', () => ({ verifyCloudEventToken: vi.fn() }))

const verified = (eventId: string) => vi.mocked(verifyCloudEventToken).mockReturnValue({ eventId } as never)
const rejected = () => vi.mocked(verifyCloudEventToken).mockReturnValue(null)

const BINDING: CloudStoreBinding = {
  boundLicenseId: 'lic-1',
  storeId: 'store-1',
  refreshToken: 'rt-1',
  instanceId: 'inst-1',
}

// A configurable fake CloudClient: every nested property access returns another
// proxy; the terminal $get/$post/$patch returns the queued cloud Response
// (`{ status, ok, json }`). Tests push the responses each call should yield.
type CloudResponse = { status: number; ok: boolean; json: () => Promise<unknown> }
function fakeCloudClient(responses: CloudResponse[]) {
  let i = 0
  const requests: Array<{ method: string; path: string; input: unknown }> = []
  const next = () => responses[i++] ?? { status: 200, ok: true, json: async () => ({}) }
  const proxy = (path: string[]): Record<string, unknown> =>
    new Proxy(
      {},
      {
        get(_target, property) {
          const segment = String(property)
          if (segment === '$get' || segment === '$post' || segment === '$patch') {
            return async (input: unknown) => {
              requests.push({ method: segment.slice(1).toUpperCase(), path: path.join('/'), input })
              return next()
            }
          }
          return proxy([...path, segment])
        },
      },
    )
  return { client: proxy([]) as never, requests }
}

const ok = (body: unknown): CloudResponse => ({ status: 200, ok: true, json: async () => body })
const fail = (status: number, body: unknown): CloudResponse => ({ status, ok: false, json: async () => body })

function pkg(overrides: Record<string, unknown> = {}) {
  return {
    id: 'pkg-1',
    storeId: 'store-1',
    type: 'store_item',
    name: 'Plan',
    description: null,
    metadata: { deliverable: { type: 'zpan.plan', storageBytes: 4096, includedCredits: 0 } },
    prices: [{ id: 'price-usd', currency: 'usd', amount: 500, recurring: { interval: 'month', intervalCount: 1 } }],
    active: true,
    sortOrder: 1,
    createdAt: '2026-05-06T00:00:00.000Z',
    updatedAt: '2026-05-06T00:00:00.000Z',
    ...overrides,
  }
}

function publication(overrides: Record<string, unknown> = {}) {
  return {
    storeId: 'store-1',
    mode: 'directory',
    listingStatus: 'listed',
    displayName: 'ZPan',
    summary: null,
    publicMetadata: {},
    skillUrl: null,
    termsUrl: null,
    healthUrl: 'https://files.example/api/health',
    healthStatus: 'healthy',
    resources: [
      {
        id: 'publication-resource-1',
        storeId: 'store-1',
        resourceId: 'pkg-1:price-usd',
        offerId: 'pro-monthly',
        title: 'Pro',
        description: null,
        productId: 'pkg-1',
        priceId: 'price-usd',
        postResourceUrl: 'https://files.example/api/store/capacity-purchases/pkg-1%3Aprice-usd',
        status: 'active',
        tags: [],
        capabilities: ['storage.capacity.purchase'],
        publicDeliverable: { type: 'zpan.plan', storageBytes: 4096 },
        productSnapshot: null,
        bazaarRequestMethod: 'POST',
        bazaarBodyType: 'json',
        bazaarInput: null,
        bazaarInputSchema: null,
        bazaarOutput: null,
        bazaarValidationStatus: 'unknown',
        bazaarValidationDiagnostic: null,
        bazaarValidatedAt: null,
        createdAt: '2026-07-30T00:00:00.000Z',
        updatedAt: '2026-07-30T00:00:00.000Z',
      },
    ],
    createdAt: '2026-07-30T00:00:00.000Z',
    updatedAt: '2026-07-30T00:00:00.000Z',
    ...overrides,
  }
}

function order(overrides: Record<string, unknown> = {}) {
  return {
    id: 'order-1',
    storeId: 'store-1',
    buyerAccountId: 'buyer-1',
    target: { orgId: 'org-1', customerId: 'org-1' },
    status: 'pending',
    paymentStatus: 'pending',
    fulfillmentStatus: 'pending',
    subtotalAmount: 500,
    discountAmount: 0,
    totalAmount: 500,
    currency: 'usd',
    items: [],
    payments: [],
    createdAt: '2026-05-06T00:00:00.000Z',
    paidAt: null,
    fulfilledAt: null,
    canceledAt: null,
    ...overrides,
  }
}

const payment = { status: 'pending', paymentId: 'pay-1', orderId: 'order-1', url: 'https://cloud.example/checkout' }
const receiver = {
  id: 'receiver-1',
  storeId: 'store-1',
  scheme: 'exact',
  network: 'eip155:8453',
  asset: '0xusdc',
  networkFamily: 'evm',
  payTo: '0xmerchant',
  status: 'active',
  verifiedAt: '2026-07-01T00:00:00.000Z',
  createdAt: '2026-07-01T00:00:00.000Z',
  updatedAt: '2026-07-01T00:00:00.000Z',
}

function attempt(status = 'quoted') {
  return {
    id: 'attempt-1',
    storeId: 'store-1',
    orderId: 'order-1',
    paymentId: status === 'delivered' ? 'payment-1' : null,
    customerId: 'org-1',
    idempotencyKey: 'idem-1',
    resourceId: 'pkg-1:price-usd',
    offerId: null,
    resourceUrl: 'https://files.example/api/store/capacity-purchases/pkg-1%3Aprice-usd',
    resourceDescription: null,
    requestHash: 'hash-1',
    productId: 'pkg-1',
    priceId: 'price-usd',
    scheme: 'exact',
    network: receiver.network,
    asset: receiver.asset,
    amount: 500,
    currency: 'usd',
    payTo: receiver.payTo,
    recurringPlan: true,
    billingPeriodStart: '2026-08-01T00:00:00.000Z',
    billingPeriodEnd: '2026-09-01T00:00:00.000Z',
    paymentRequired: {
      x402Version: 2,
      resource: { url: 'https://files.example/api/store/capacity-purchases/pkg-1%3Aprice-usd' },
      accepts: [
        {
          scheme: 'exact',
          network: receiver.network,
          asset: receiver.asset,
          amount: '500',
          payTo: receiver.payTo,
          maxTimeoutSeconds: 300,
          extra: {},
        },
      ],
    },
    paymentRequiredHeader: 'required-header',
    paymentSignatureHeader: status === 'quoted' ? null : 'signature',
    payer: status === 'quoted' ? null : '0xpayer',
    paymentIdentifier: null,
    authorizationHash: null,
    planFamily: 'storage',
    planKey: 'pro',
    tierRank: 1,
    billingInterval: 'month',
    settlementTransaction: status === 'delivered' ? '0xtx' : null,
    settlementResponseHeader: status === 'delivered' ? 'response-header' : null,
    status,
    lastErrorCode: null,
    quotedAt: '2026-07-30T00:00:00.000Z',
    expiresAt: '2099-07-30T00:05:00.000Z',
    verifiedAt: status === 'quoted' ? null : '2026-07-30T00:01:00.000Z',
    settlingAt: null,
    settledAt: status === 'delivered' ? '2026-07-30T00:02:00.000Z' : null,
    canceledAt: null,
    createdAt: '2026-07-30T00:00:00.000Z',
    updatedAt: '2026-07-30T00:00:00.000Z',
  }
}

const noPlanQuota = { currentPlan: null } as EffectiveQuota
const subscribedQuota = { currentPlan: { subscription: true } } as EffectiveQuota

function makeDeps(
  options: {
    binding?: CloudStoreBinding | 'missing'
    responses?: CloudResponse[]
    targets?: CloudStoreTarget[]
    customerLabel?: string | null
    quota?: EffectiveQuota
    processResult?: { duplicate: boolean; eventId: string }
    processThrows?: Error
  } = {},
) {
  const getCloudStoreBinding = vi.fn(async () => {
    if (options.binding === 'missing') throw new Error('quota_store_binding_missing')
    return options.binding ?? BINDING
  })
  const processCloudOrderQuotaChange = vi.fn(async () => {
    if (options.processThrows) throw options.processThrows
    return options.processResult ?? { duplicate: false, eventId: 'evt-1' }
  })
  const cloudStore: CloudStoreRepo = {
    getCloudStoreBinding,
    getAccessibleTargets: async () => options.targets ?? [],
    getCustomerLabel: async () => options.customerLabel ?? 'buyer@example.com',
    processCloudOrderQuotaChange,
  }
  // The usecase rebinds a client per cloud request (buildBoundCloudClient runs on
  // every cloudRequest), so the fake must be a single instance whose response queue
  // advances across calls — rebuilding it per call would reset the counter and replay
  // response #0, breaking multi-call flows (checkout, continue/cancel order).
  const fake = fakeCloudClient(options.responses ?? [])
  const createBoundCloudClient = vi.fn(() => fake.client)
  const licensingCloud = { createBoundCloudClient } as unknown as LicensingCloudGateway
  const quota = { getEffectiveQuota: async () => options.quota ?? noPlanQuota } as unknown as QuotaRepo
  let purchaseIntent: X402CapacityPurchaseIntent | null = null
  const x402CapacityPurchases: X402CapacityPurchaseRepo = {
    get: async () => purchaseIntent,
    create: async (input) => {
      purchaseIntent = {
        id: 'intent-1',
        ...input,
        cloudOrderId: null,
        cloudAttemptId: null,
        status: 'created',
        expiresAt: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      }
      return purchaseIntent
    },
    claimCloudOrder: async () => {
      if (!purchaseIntent || purchaseIntent.cloudOrderId) return false
      purchaseIntent = { ...purchaseIntent, status: 'ordering', updatedAt: new Date() }
      return true
    },
    updateCloudState: async (_id, input) => {
      if (!purchaseIntent) throw new Error('missing_intent')
      purchaseIntent = { ...purchaseIntent, ...input, updatedAt: new Date() }
    },
  }
  const deps: CloudStoreDeps & { x402CapacityPurchases: X402CapacityPurchaseRepo } = {
    cloudStore,
    licensingCloud,
    quota,
    x402CapacityPurchases,
  }
  return { deps, getCloudStoreBinding, processCloudOrderQuotaChange, createBoundCloudClient, requests: fake.requests }
}

const CLOUD = 'https://cloud.example'

beforeEach(() => vi.clearAllMocks())

describe('cloud-store usecase', () => {
  describe('getStoreReadiness', () => {
    it('is ready when a binding exists', async () => {
      const { deps } = makeDeps()
      expect(await getStoreReadiness(deps)).toEqual({ ready: true })
    })

    it('is not ready when the binding is missing', async () => {
      const { deps } = makeDeps({ binding: 'missing' })
      expect(await getStoreReadiness(deps)).toEqual({ ready: false, error: 'quota_store_binding_missing' })
    })

    it('rethrows unexpected binding errors', async () => {
      const { deps } = makeDeps()
      vi.mocked(deps.cloudStore.getCloudStoreBinding).mockRejectedValueOnce(new Error('boom'))
      await expect(getStoreReadiness(deps)).rejects.toThrow('boom')
    })
  })

  describe('storefront reads', () => {
    it('listPackages keeps only zpan.plan deliverables', async () => {
      const credits = pkg({
        id: 'pkg-credits',
        metadata: { deliverable: { type: 'zpan.credits', includedCredits: 5 } },
      })
      const { deps } = makeDeps({ responses: [ok({ items: [pkg(), credits], total: 2, limit: 100, offset: 0 })] })
      const out = await listPackages(deps, CLOUD)
      expect(out).toEqual({ ok: true, value: { items: [pkg()], total: 1, limit: 100, offset: 0 } })
    })

    it('listCreditProducts keeps only zpan.credits deliverables', async () => {
      const credits = pkg({
        id: 'pkg-credits',
        metadata: { deliverable: { type: 'zpan.credits', includedCredits: 5 } },
        prices: [{ id: 'price-usd', currency: 'usd', amount: 200 }],
      })
      const { deps } = makeDeps({ responses: [ok({ items: [pkg(), credits], total: 2, limit: 100, offset: 0 })] })
      const out = await listCreditProducts(deps, CLOUD)
      expect(out.ok && out.value.items).toEqual([credits])
    })

    it('listPackages returns binding_missing when unbound', async () => {
      const { deps } = makeDeps({ binding: 'missing' })
      expectError(await listPackages(deps, CLOUD), { httpStatus: 403, message: 'quota_store_binding_missing' })
    })

    it('listPackages surfaces a cloud error', async () => {
      const { deps } = makeDeps({ responses: [fail(503, { error: 'cloud_down' })] })
      expectError(await listPackages(deps, CLOUD), { httpStatus: 502, message: 'cloud_down' })
    })

    it('listPackages surfaces a malformed cloud response', async () => {
      const { deps } = makeDeps({ responses: [ok({ nope: true })] })
      expectError(await listPackages(deps, CLOUD), { httpStatus: 502, message: 'invalid_cloud_response' })
    })

    it('lists every standard capacity price that closes the workspace gap', async () => {
      const { deps } = makeDeps({
        responses: [
          ok({
            items: [
              pkg({
                prices: [
                  { id: 'monthly', currency: 'usd', amount: 500, recurring: { interval: 'month', intervalCount: 1 } },
                  { id: 'yearly', currency: 'usd', amount: 5000, recurring: { interval: 'year', intervalCount: 1 } },
                ],
              }),
              pkg({
                id: 'too-small',
                metadata: { deliverable: { type: 'zpan.plan', storageBytes: 100 } },
              }),
            ],
            total: 2,
            limit: 100,
            offset: 0,
          }),
          ok(
            publication({
              resources: [
                {
                  ...publication().resources[0],
                  priceId: 'monthly',
                  resourceId: 'pro-monthly',
                },
                {
                  ...publication().resources[0],
                  priceId: 'yearly',
                  resourceId: 'pro-yearly',
                },
              ],
            }),
          ),
        ],
        quota: {
          used: 1000,
          quota: 900,
          currentPlan: { storageBytes: 800 },
        } as EffectiveQuota,
      })

      const out = await listCapacityOffers(deps, CLOUD, { orgId: 'org-1', requestedBytes: 200 })

      expect(out.ok && out.value).toMatchObject([
        { resourceId: 'pro-monthly', productId: 'pkg-1', priceId: 'monthly', storageBytes: 4096 },
        { resourceId: 'pro-yearly', productId: 'pkg-1', priceId: 'yearly', storageBytes: 4096 },
      ])
    })

    it('listTargets returns the accessible targets without a cloud call', async () => {
      const targets = [{ orgId: 'org-1', type: 'personal' }] as unknown as CloudStoreTarget[]
      const { deps, createBoundCloudClient } = makeDeps({ targets })
      const out = await listTargets(deps, 'user-1')
      expect(out).toEqual({ ok: true, value: { items: targets, total: 1 } })
      expect(createBoundCloudClient).not.toHaveBeenCalled()
    })

    it('getCreditBalance proxies the balance for the org', async () => {
      const { deps } = makeDeps({ responses: [ok({ balance: 1250 })] })
      expect(await getCreditBalance(deps, CLOUD, 'org-1')).toEqual({ ok: true, value: { balance: 1250 } })
    })

    it('redeemGiftCard proxies the redemption', async () => {
      const body = { redeemedCredits: 1000, entries: [], failures: [] }
      const { deps } = makeDeps({ responses: [ok(body)] })
      const out = await redeemGiftCard(deps, CLOUD, { orgId: 'org-1', input: { code: 'ZS-1' } })
      expect(out).toEqual({ ok: true, value: body })
    })
  })

  describe('createCheckout', () => {
    it('creates an order then a payment and returns the payment', async () => {
      const { deps, createBoundCloudClient } = makeDeps({ responses: [ok(pkg()), ok(order()), ok(payment)] })
      const out = await createCheckout(deps, CLOUD, {
        userId: 'user-1',
        orgId: 'org-1',
        origin: 'https://files.example',
        input: { packageId: 'pkg-1' },
      })
      expect(out).toEqual({ ok: true, value: payment })
      expect(createBoundCloudClient).toHaveBeenCalledWith(CLOUD, 'rt-1')
    })

    it('returns binding_missing when unbound', async () => {
      const { deps } = makeDeps({ binding: 'missing' })
      const out = await createCheckout(deps, CLOUD, {
        userId: 'user-1',
        orgId: 'org-1',
        origin: 'https://files.example',
        input: { packageId: 'pkg-1' },
      })
      expectError(out, { httpStatus: 403, message: 'quota_store_binding_missing' })
    })

    it('returns price_missing when the requested priceId is not on the product', async () => {
      const { deps } = makeDeps({ responses: [ok(pkg())] })
      const out = await createCheckout(deps, CLOUD, {
        userId: 'user-1',
        orgId: 'org-1',
        origin: 'https://files.example',
        input: { packageId: 'pkg-1', priceId: 'price-does-not-exist' },
      })
      expectError(out, { httpStatus: 400, reason: 'PACKAGE_PRICE_MISSING', message: 'Package price missing' })
    })

    it('returns price_missing when the only USD price is metered', async () => {
      const meteredOnly = pkg({
        prices: [
          {
            id: 'price-m',
            currency: 'usd',
            amount: 2,
            recurring: { interval: 'month', intervalCount: 1, usageType: 'metered' },
          },
        ],
      })
      const { deps } = makeDeps({ responses: [ok(meteredOnly)] })
      const out = await createCheckout(deps, CLOUD, {
        userId: 'user-1',
        orgId: 'org-1',
        origin: 'https://files.example',
        input: { packageId: 'pkg-1' },
      })
      expectError(out, { httpStatus: 400, reason: 'PACKAGE_PRICE_MISSING', message: 'Package price missing' })
    })

    it('rejects a recurring checkout when the workspace already has a subscription plan', async () => {
      const { deps } = makeDeps({ responses: [ok(pkg())], quota: subscribedQuota })
      const out = await createCheckout(deps, CLOUD, {
        userId: 'user-1',
        orgId: 'org-1',
        origin: 'https://files.example',
        input: { packageId: 'pkg-1' },
      })
      expectError(out, { httpStatus: 409, reason: 'WORKSPACE_PLAN_EXISTS', message: 'Workspace plan already exists' })
    })

    it('surfaces a cloud error from order creation', async () => {
      const { deps } = makeDeps({ responses: [ok(pkg()), fail(503, { error: 'cloud_down' })] })
      const out = await createCheckout(deps, CLOUD, {
        userId: 'user-1',
        orgId: 'org-1',
        origin: 'https://files.example',
        input: { packageId: 'pkg-1' },
      })
      expectError(out, { httpStatus: 502, message: 'cloud_down' })
    })

    it('allows a one-time (non-recurring) price without consulting quota', async () => {
      const oneTime = pkg({ prices: [{ id: 'price-usd', currency: 'usd', amount: 500 }] })
      const getEffectiveQuota = vi.fn(async () => noPlanQuota)
      const { deps } = makeDeps({ responses: [ok(oneTime), ok(order()), ok(payment)] })
      deps.quota.getEffectiveQuota = getEffectiveQuota
      const out = await createCheckout(deps, CLOUD, {
        userId: 'user-1',
        orgId: 'org-1',
        origin: 'https://files.example',
        input: { packageId: 'pkg-1' },
      })
      expect(out.ok).toBe(true)
      expect(getEffectiveQuota).not.toHaveBeenCalled()
    })
  })

  describe('purchaseCapacity', () => {
    const params = {
      userId: 'user-1',
      orgId: 'org-1',
      origin: 'https://files.example',
      resourceId: 'pkg-1:price-usd',
      requestHash: 'hash-1',
      idempotencyKey: 'idem-1',
      paymentSignature: null,
    }

    it('creates an idempotent order and returns the standard x402 challenge', async () => {
      const quote = { ...attempt(), reused: false }
      const { deps, requests } = makeDeps({
        responses: [ok(publication()), ok(pkg()), ok(receiver), ok(order()), ok(quote)],
      })

      const out = await purchaseCapacity(deps, CLOUD, params)

      expect(out).toEqual({
        ok: true,
        kind: 'payment_required',
        paymentRequired: quote.paymentRequired,
        paymentRequiredHeader: quote.paymentRequiredHeader,
      })
      expect(requests[3]?.input).toMatchObject({
        json: {
          idempotencyKey: 'zpan-x402-capacity:intent-1',
        },
      })
      expect(requests[4]).toMatchObject({
        method: 'POST',
        path: 'stores/:storeId/orders/:orderId/x402/payment-attempts',
        input: {
          header: { 'Idempotency-Key': params.idempotencyKey },
          json: {
            requestHash: params.requestHash,
            resourceId: params.resourceId,
          },
        },
      })
      expect(requests[4]?.input).not.toMatchObject({ json: { idempotencyKey: expect.anything() } })
    })

    it('returns forbidden before calling Cloud when the quota store is not bound', async () => {
      const { deps, createBoundCloudClient } = makeDeps({ binding: 'missing' })

      const out = await purchaseCapacity(deps, CLOUD, params)

      expectError(out, { httpStatus: 403, message: 'quota_store_binding_missing' })
      expect(createBoundCloudClient).not.toHaveBeenCalled()
    })

    it('returns bad request when the published capacity offer does not exist', async () => {
      const { deps } = makeDeps({
        responses: [ok(publication({ resources: [] }))],
      })

      const out = await purchaseCapacity(deps, CLOUD, params)

      expectError(out, {
        httpStatus: 400,
        reason: 'CAPACITY_OFFER_NOT_FOUND',
        message: 'Invalid capacity offer',
      })
    })

    it('rejects a capacity purchase when the x402 receiver is not active', async () => {
      const { deps, requests } = makeDeps({
        responses: [ok(publication()), ok(pkg()), ok({ ...receiver, status: 'pending_verification' })],
      })

      const out = await purchaseCapacity(deps, CLOUD, params)

      expectError(out, { httpStatus: 502, message: 'x402_receiver_not_active' })
      expect(requests).toHaveLength(3)
    })

    it('returns a retryable conflict when another request is creating the Cloud order', async () => {
      const { deps, requests } = makeDeps({
        responses: [ok(publication()), ok(pkg()), ok(receiver)],
      })
      deps.x402CapacityPurchases.claimCloudOrder = vi.fn(async () => false)

      const out = await purchaseCapacity(deps, CLOUD, params)

      expectError(out, {
        httpStatus: 409,
        reason: 'X402_PURCHASE_IN_PROGRESS',
        message: 'Purchase initialization is in progress',
      })
      expect(requests).toHaveLength(3)
    })

    it('rate-limits new unpaid purchase intents before creating a Cloud order', async () => {
      const { deps, requests } = makeDeps({
        responses: [ok(publication()), ok(pkg()), ok(receiver)],
      })
      deps.x402CapacityPurchases.create = vi.fn(async () => null)

      const out = await purchaseCapacity(deps, CLOUD, params)

      expectError(out, {
        httpStatus: 429,
        message: 'Too many pending capacity purchases',
      })
      expect((out as { error: AppError }).error.meta.headers).toEqual({ 'Retry-After': '3600' })
      expect(requests).toHaveLength(3)
    })

    it('returns a purchase conflict when intent reservation fails without a concurrent winner', async () => {
      const { deps, requests } = makeDeps({
        responses: [ok(publication()), ok(pkg()), ok(receiver)],
      })
      deps.x402CapacityPurchases.create = vi.fn(async () => {
        throw new Error('unique constraint')
      })

      const out = await purchaseCapacity(deps, CLOUD, params)

      expectError(out, {
        httpStatus: 409,
        reason: 'X402_PURCHASE_CONFLICT',
        message: 'Purchase request conflict',
      })
      expect(requests).toHaveLength(3)
    })

    it('recovers an existing purchase request with a different idempotency key', async () => {
      const quoted = attempt()
      const { deps, requests } = makeDeps({
        responses: [
          ok(publication()),
          ok(pkg()),
          ok(receiver),
          ok(order()),
          ok({ ...quoted, reused: false }),
          ok(publication()),
          ok(pkg()),
          ok(receiver),
          ok(quoted),
        ],
      })
      await purchaseCapacity(deps, CLOUD, params)

      const out = await purchaseCapacity(deps, CLOUD, { ...params, idempotencyKey: 'different-key' })

      expect(out).toEqual({
        ok: true,
        kind: 'payment_required',
        paymentRequired: quoted.paymentRequired,
        paymentRequiredHeader: quoted.paymentRequiredHeader,
      })
      expect(requests).toHaveLength(9)
    })

    it('releases the local order claim when Cloud order creation fails', async () => {
      const { deps } = makeDeps({
        responses: [ok(publication()), ok(pkg()), ok(receiver), fail(503, { error: 'cloud_down' })],
      })
      const updateCloudState = vi.spyOn(deps.x402CapacityPurchases, 'updateCloudState')

      const out = await purchaseCapacity(deps, CLOUD, params)

      expectError(out, { httpStatus: 502, message: 'cloud_down' })
      expect(updateCloudState).toHaveBeenCalledWith('intent-1', { status: 'created' })
    })

    it('lets a fresh caller recover an intent after Cloud order creation fails', async () => {
      const quoted = attempt()
      const { deps } = makeDeps({
        responses: [
          ok(publication()),
          ok(pkg()),
          ok(receiver),
          fail(503, { error: 'cloud_down' }),
          ok(publication()),
          ok(pkg()),
          ok(receiver),
          ok(order()),
          ok({ ...quoted, reused: false }),
        ],
      })

      const first = await purchaseCapacity(deps, CLOUD, params)
      expectError(first, { httpStatus: 502, message: 'cloud_down' })

      const recovered = await purchaseCapacity(deps, CLOUD, {
        ...params,
        idempotencyKey: 'fresh-caller-key',
      })

      expect(recovered).toEqual({
        ok: true,
        kind: 'payment_required',
        paymentRequired: quoted.paymentRequired,
        paymentRequiredHeader: quoted.paymentRequiredHeader,
      })
    })

    it('reuses the intent, verifies payment, settles, and returns the receipt', async () => {
      const quoted = attempt()
      const verifiedAttempt = attempt('verified')
      const paidPendingFulfillment = attempt('paid_pending_fulfillment')
      const delivered = attempt('delivered')
      const { deps, requests } = makeDeps({
        responses: [
          ok(publication()),
          ok(pkg()),
          ok(receiver),
          ok(order()),
          ok({ ...quoted, reused: false }),
          ok(publication()),
          ok(pkg()),
          ok(receiver),
          ok(quoted),
          ok(verifiedAttempt),
          ok(paidPendingFulfillment),
          ok(delivered),
        ],
      })
      await purchaseCapacity(deps, CLOUD, params)

      const out = await purchaseCapacity(deps, CLOUD, { ...params, paymentSignature: 'signature' })

      expect(out).toMatchObject({
        ok: true,
        kind: 'delivered',
        paymentResponseHeader: 'response-header',
        purchase: { attemptId: 'attempt-1', status: 'delivered' },
      })
      expect(requests[8]).toMatchObject({
        method: 'GET',
        path: 'stores/:storeId/orders/:orderId/x402/payment-attempts/:attemptId',
      })
      expect(requests[9]).toMatchObject({
        method: 'POST',
        path: 'stores/:storeId/orders/:orderId/x402/payment-attempts/:attemptId/verifications',
        input: {
          header: { 'PAYMENT-SIGNATURE': 'signature' },
          json: { requestHash: params.requestHash },
        },
      })
      expect(requests[9]?.input).not.toMatchObject({ json: { paymentSignature: expect.anything() } })
      expect(requests[10]).toMatchObject({
        method: 'POST',
        path: 'stores/:storeId/orders/:orderId/x402/payment-attempts/:attemptId/settlements',
      })
      expect(requests[11]).toMatchObject({
        method: 'POST',
        path: 'stores/:storeId/orders/:orderId/x402/payment-attempts/:attemptId/fulfillment-attempts',
        input: { json: { deliveryCallbackUrl: `${params.origin}/api/store/webhook` } },
      })
    })

    it('returns an already delivered attempt after quote expiry without creating a replacement quote', async () => {
      const quoted = attempt()
      const delivered = { ...attempt('delivered'), expiresAt: '2026-07-30T00:00:00.000Z' }
      const { deps, requests } = makeDeps({
        responses: [
          ok(publication()),
          ok(pkg()),
          ok(receiver),
          ok(order()),
          ok({ ...quoted, reused: false }),
          ok(publication()),
          ok(pkg()),
          ok(receiver),
          ok(delivered),
        ],
      })
      await purchaseCapacity(deps, CLOUD, params)

      const out = await purchaseCapacity(deps, CLOUD, params)

      expect(out).toMatchObject({
        ok: true,
        kind: 'delivered',
        paymentResponseHeader: 'response-header',
        purchase: { attemptId: 'attempt-1', status: 'delivered' },
      })
      expect(
        requests.filter((request) => request.path === 'stores/:storeId/orders/:orderId/x402/payment-attempts'),
      ).toHaveLength(1)
    })

    it('retries paid-pending fulfillment with the current callback and no payment replay', async () => {
      const quoted = attempt()
      const paidPending = { ...attempt('paid_pending_fulfillment'), expiresAt: '2026-07-30T00:00:00.000Z' }
      const delivered = { ...attempt('delivered'), expiresAt: '2026-07-30T00:00:00.000Z' }
      const { deps, requests } = makeDeps({
        responses: [
          ok(publication()),
          ok(pkg()),
          ok(receiver),
          ok(order()),
          ok({ ...quoted, reused: false }),
          ok(publication()),
          ok(pkg()),
          ok(receiver),
          ok(paidPending),
          ok(delivered),
        ],
      })
      await purchaseCapacity(deps, CLOUD, params)

      const out = await purchaseCapacity(deps, CLOUD, { ...params, idempotencyKey: 'fresh-caller-key' })

      expect(out).toMatchObject({
        ok: true,
        kind: 'delivered',
        paymentResponseHeader: 'response-header',
        purchase: { attemptId: 'attempt-1', status: 'delivered' },
      })
      expect(
        requests.filter((request) => request.path === 'stores/:storeId/orders/:orderId/x402/payment-attempts'),
      ).toHaveLength(1)
      expect(requests.at(-1)).toMatchObject({
        method: 'POST',
        path: 'stores/:storeId/orders/:orderId/x402/payment-attempts/:attemptId/fulfillment-attempts',
        input: { json: { deliveryCallbackUrl: `${params.origin}/api/store/webhook` } },
      })
      expect(requests).not.toContainEqual(
        expect.objectContaining({
          path: 'stores/:storeId/orders/:orderId/x402/payment-attempts/:attemptId/settlements',
        }),
      )
    })

    it('continues a verified attempt through settlement without replaying the payment signature', async () => {
      const quoted = attempt()
      const verified = { ...attempt('verified'), expiresAt: '2026-07-30T00:00:00.000Z' }
      const paidPending = { ...attempt('paid_pending_fulfillment'), expiresAt: '2026-07-30T00:00:00.000Z' }
      const delivered = { ...attempt('delivered'), expiresAt: '2026-07-30T00:00:00.000Z' }
      const { deps, requests } = makeDeps({
        responses: [
          ok(publication()),
          ok(pkg()),
          ok(receiver),
          ok(order()),
          ok({ ...quoted, reused: false }),
          ok(publication()),
          ok(pkg()),
          ok(receiver),
          ok(verified),
          ok(paidPending),
          ok(delivered),
        ],
      })
      await purchaseCapacity(deps, CLOUD, params)

      const out = await purchaseCapacity(deps, CLOUD, { ...params, idempotencyKey: 'fresh-caller-key' })

      expect(out).toMatchObject({ ok: true, kind: 'delivered', purchase: { status: 'delivered' } })
      expect(requests).not.toContainEqual(
        expect.objectContaining({
          path: 'stores/:storeId/orders/:orderId/x402/payment-attempts/:attemptId/verifications',
        }),
      )
      expect(requests.at(-2)).toMatchObject({
        method: 'POST',
        path: 'stores/:storeId/orders/:orderId/x402/payment-attempts/:attemptId/settlements',
      })
      expect(requests.at(-1)).toMatchObject({
        method: 'POST',
        path: 'stores/:storeId/orders/:orderId/x402/payment-attempts/:attemptId/fulfillment-attempts',
      })
    })

    it('returns a client error when Cloud rejects the payment signature', async () => {
      const quoted = attempt()
      const { deps } = makeDeps({
        responses: [
          ok(publication()),
          ok(pkg()),
          ok(receiver),
          ok(order()),
          ok({ ...quoted, reused: false }),
          ok(publication()),
          ok(pkg()),
          ok(receiver),
          ok(quoted),
          fail(400, { error: 'x402_payment_proof_invalid' }),
        ],
      })
      await purchaseCapacity(deps, CLOUD, params)

      const out = await purchaseCapacity(deps, CLOUD, { ...params, paymentSignature: 'invalid-signature' })

      expectError(out, {
        httpStatus: 400,
        reason: 'X402_PAYMENT_PROOF_INVALID',
        message: 'x402_payment_proof_invalid',
      })
    })

    it('replaces an expired quote with a fresh challenge for the same purchase intent', async () => {
      const quoted = attempt()
      const expired = { ...attempt(), expiresAt: '2026-07-30T00:00:00.000Z' }
      const replacement = {
        ...attempt(),
        id: 'attempt-2',
        idempotencyKey: 'replacement-idempotency',
        paymentRequiredHeader: 'replacement-required-header',
        expiresAt: '2099-07-30T00:05:00.000Z',
        reused: false,
      }
      const { deps, requests } = makeDeps({
        responses: [
          ok(publication()),
          ok(pkg()),
          ok(receiver),
          ok(order()),
          ok({ ...quoted, reused: false }),
          ok(publication()),
          ok(pkg()),
          ok(receiver),
          ok(expired),
          ok(replacement),
        ],
      })
      await purchaseCapacity(deps, CLOUD, params)

      const out = await purchaseCapacity(deps, CLOUD, { ...params, paymentSignature: 'expired-signature' })

      expect(out).toMatchObject({
        ok: true,
        kind: 'payment_required',
        paymentRequiredHeader: 'replacement-required-header',
      })
      const quoteRequests = requests.filter(
        (request) =>
          request.method === 'POST' &&
          typeof request.input === 'object' &&
          request.input !== null &&
          'json' in request.input &&
          typeof request.input.json === 'object' &&
          request.input.json !== null &&
          'requestHash' in request.input.json,
      )
      expect(quoteRequests).toHaveLength(2)
      expect(quoteRequests[1]?.input).toMatchObject({
        header: {
          'Idempotency-Key': expect.stringMatching(/^x402-retry:[0-9a-f]{64}$/),
        },
        json: {
          requestHash: params.requestHash,
          resourceId: params.resourceId,
        },
      })
    })
  })

  describe('order actions', () => {
    it('continueOrderPayment returns not_found for an empty orderId', async () => {
      const { deps } = makeDeps()
      const out = await continueOrderPayment(deps, CLOUD, { orgId: 'org-1', orderId: undefined, origin: 'o' })
      expectError(out, { httpStatus: 404, message: 'Order not found' })
    })

    it('continueOrderPayment rejects an order belonging to another org', async () => {
      const { deps } = makeDeps({ responses: [ok(order({ target: { orgId: 'org-other', customerId: 'org-other' } }))] })
      const out = await continueOrderPayment(deps, CLOUD, {
        orgId: 'org-1',
        orderId: 'order-1',
        origin: 'https://files.example',
      })
      expectError(out, { httpStatus: 403, message: 'Forbidden' })
    })

    it('continueOrderPayment continues payment for an owned order', async () => {
      const { deps } = makeDeps({ responses: [ok(order()), ok(payment)] })
      const out = await continueOrderPayment(deps, CLOUD, {
        orgId: 'org-1',
        orderId: 'order-1',
        origin: 'https://files.example',
      })
      expect(out).toEqual({ ok: true, value: payment })
    })

    it('continueOrderPayment surfaces a cloud error fetching the order', async () => {
      const { deps } = makeDeps({ responses: [fail(503, { error: 'cloud_down' })] })
      const out = await continueOrderPayment(deps, CLOUD, {
        orgId: 'org-1',
        orderId: 'order-1',
        origin: 'https://files.example',
      })
      expectError(out, { httpStatus: 502, message: 'cloud_down' })
    })

    it('cancelOrder cancels an owned order', async () => {
      const canceled = order({ status: 'canceled' })
      const { deps } = makeDeps({ responses: [ok(order()), ok(canceled)] })
      const out = await cancelOrder(deps, CLOUD, { orgId: 'org-1', orderId: 'order-1', status: 'canceled' })
      expect(out.ok && (out.value as { status: string }).status).toBe('canceled')
    })

    it('cancelOrder rejects another org order', async () => {
      const { deps } = makeDeps({ responses: [ok(order({ target: { orgId: 'org-other' } }))] })
      const out = await cancelOrder(deps, CLOUD, { orgId: 'org-1', orderId: 'order-1', status: 'canceled' })
      expectError(out, { httpStatus: 403, message: 'Forbidden' })
    })
  })

  describe('createBillingPortalSession', () => {
    it('proxies a portal session with the org return URL', async () => {
      const session = { url: 'https://billing.example', stripeSubscriptionId: 'sub_1' }
      const { deps, requests } = makeDeps({ responses: [ok(session)] })
      const out = await createBillingPortalSession(deps, CLOUD, { orgId: 'org-1', origin: 'https://files.example' })
      expect(out).toEqual({ ok: true, value: session })
      expect(requests[0]).toMatchObject({
        method: 'POST',
        path: 'stores/:storeId/billing/portal-sessions',
        input: {
          param: { storeId: 'store-1' },
          json: { customerId: 'org-1', returnUrl: 'https://files.example/storage' },
        },
      })
    })
  })

  describe('processDeliveryWebhook', () => {
    const validEvent: CloudOrderQuotaChange = {
      eventId: 'evt-1',
      eventType: 'order.quota_changed',
      cloudOrderId: 'order-1',
      targetOrgId: 'org-1',
      direction: 'increase',
      storageBytes: 4096,
      trafficBytes: 0,
    } as CloudOrderQuotaChange

    const params = (body: unknown, eventToken = 'tok') => ({
      cloudBaseUrl: CLOUD,
      eventToken,
      rawPayload: JSON.stringify(body),
      payloadHash: 'hash',
      body,
    })

    it('rejects an invalid event token before touching the repo', async () => {
      rejected()
      const { deps, processCloudOrderQuotaChange } = makeDeps()
      const out = await processDeliveryWebhook(deps, params(validEvent))
      expectError(out, { httpStatus: 401, reason: 'INVALID_EVENT_TOKEN', message: 'Invalid event token' })
      expect(processCloudOrderQuotaChange).not.toHaveBeenCalled()
    })

    it('rejects a null body (unparseable JSON) as invalid_payload', async () => {
      verified('evt-1')
      const { deps } = makeDeps()
      const out = await processDeliveryWebhook(deps, params(null))
      expectError(out, { httpStatus: 400, reason: 'INVALID_PAYLOAD', message: 'Invalid payload' })
    })

    it('rejects a body that fails the quota-change schema', async () => {
      verified('evt-1')
      const { deps } = makeDeps()
      const out = await processDeliveryWebhook(deps, params({ eventId: 'evt-1' }))
      expectError(out, { httpStatus: 400, reason: 'INVALID_PAYLOAD', message: 'Invalid payload' })
    })

    it('rejects a body whose eventId differs from the token eventId', async () => {
      verified('evt-token')
      const { deps, processCloudOrderQuotaChange } = makeDeps()
      const out = await processDeliveryWebhook(deps, params(validEvent))
      expectError(out, { httpStatus: 401, reason: 'INVALID_EVENT_TOKEN', message: 'Invalid event token' })
      expect(processCloudOrderQuotaChange).not.toHaveBeenCalled()
    })

    it('fulfills a valid event and reports duplicate=false', async () => {
      verified('evt-1')
      const { deps, processCloudOrderQuotaChange } = makeDeps({ processResult: { duplicate: false, eventId: 'evt-1' } })
      const out = await processDeliveryWebhook(deps, params(validEvent))
      expect(out).toMatchObject({ ok: true, duplicate: false, eventId: 'evt-1' })
      expect(processCloudOrderQuotaChange).toHaveBeenCalledWith(
        expect.objectContaining({ eventId: 'evt-1', direction: 'increase' }),
        JSON.stringify(validEvent),
        'hash',
      )
    })

    it('accepts x402 recurring fulfillment with a provider-neutral billing period identity', async () => {
      const body = {
        eventId: 'evt-x402',
        eventType: 'commerce.order_item.fulfilled',
        orderId: 'order-x402',
        orderItemId: 'item-x402',
        productId: 'product-pro',
        productName: 'Pro',
        quantity: 1,
        deliverable: { type: 'zpan.plan', storageBytes: 1024 },
        target: { orgId: 'org-1', customerId: 'org-1' },
        context: {
          storeId: 'store-1',
          paymentProvider: 'x402',
          providerTransactionId: '0xtx',
          x402AuditContext: { network: 'eip155:8453' },
          billingPeriodStart: '2026-08-01T00:00:00.000Z',
          billingPeriodEnd: '2026-09-01T00:00:00.000Z',
        },
        occurredAt: '2026-07-30T00:00:00.000Z',
      }
      verified('evt-x402')
      const { deps, processCloudOrderQuotaChange } = makeDeps({
        processResult: { duplicate: false, eventId: 'evt-x402' },
      })

      const out = await processDeliveryWebhook(deps, params(body))

      expect(out).toMatchObject({ ok: true, eventId: 'evt-x402' })
      expect(processCloudOrderQuotaChange).toHaveBeenCalledWith(
        expect.objectContaining({
          cloudOrderId: 'x402:period:product-pro:2026-08-01T00:00:00.000Z:2026-09-01T00:00:00.000Z:org-1',
          entitlementType: 'plan',
          startsAt: '2026-08-01T00:00:00.000Z',
          expiresAt: '2026-09-01T00:00:00.000Z',
          paymentProvider: 'x402',
          providerTransactionId: '0xtx',
        }),
        JSON.stringify(body),
        'hash',
      )
    })

    it('reports duplicate=true on an idempotent replay', async () => {
      verified('evt-1')
      const { deps } = makeDeps({ processResult: { duplicate: true, eventId: 'evt-1' } })
      const out = await processDeliveryWebhook(deps, params(validEvent))
      expect(out).toMatchObject({ ok: true, duplicate: true, eventId: 'evt-1' })
    })

    it('surfaces a fulfillment failure as processing_failed', async () => {
      verified('evt-1')
      const { deps } = makeDeps({ processThrows: new Error('webhook_payload_conflict') })
      const out = await processDeliveryWebhook(deps, params(validEvent))
      expectError(out, { httpStatus: 400, message: 'webhook_payload_conflict' })
    })

    it('passes the bound license + payload hash to token verification', async () => {
      verified('evt-1')
      const { deps } = makeDeps()
      await processDeliveryWebhook(deps, params(validEvent))
      expect(verifyCloudEventToken).toHaveBeenCalledWith('tok', {
        cloudBaseUrl: CLOUD,
        instanceId: BINDING.instanceId,
        boundLicenseId: BINDING.boundLicenseId,
        payloadHash: 'hash',
      })
    })
  })
})
