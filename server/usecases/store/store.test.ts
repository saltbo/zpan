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
  listCreditProducts,
  listPackages,
  listTargets,
  processDeliveryWebhook,
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
  const next = () => responses[i++] ?? { status: 200, ok: true, json: async () => ({}) }
  const handler: ProxyHandler<Record<string, unknown>> = {
    get(_t, prop) {
      if (prop === '$get' || prop === '$post' || prop === '$patch') return async () => next()
      return new Proxy({}, handler)
    },
  }
  return new Proxy({}, handler) as never
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
  const client = fakeCloudClient(options.responses ?? [])
  const createBoundCloudClient = vi.fn(() => client)
  const licensingCloud = { createBoundCloudClient } as unknown as LicensingCloudGateway
  const quota = { getEffectiveQuota: async () => options.quota ?? noPlanQuota } as unknown as QuotaRepo
  const deps: CloudStoreDeps = { cloudStore, licensingCloud, quota }
  return { deps, getCloudStoreBinding, processCloudOrderQuotaChange, createBoundCloudClient }
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
      const { deps } = makeDeps({ responses: [ok(session)] })
      const out = await createBillingPortalSession(deps, CLOUD, { orgId: 'org-1', origin: 'https://files.example' })
      expect(out).toEqual({ ok: true, value: session })
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
      expect(out).toEqual({ ok: true, duplicate: false, eventId: 'evt-1' })
      expect(processCloudOrderQuotaChange).toHaveBeenCalledWith(
        expect.objectContaining({ eventId: 'evt-1', direction: 'increase' }),
        JSON.stringify(validEvent),
        'hash',
      )
    })

    it('reports duplicate=true on an idempotent replay', async () => {
      verified('evt-1')
      const { deps } = makeDeps({ processResult: { duplicate: true, eventId: 'evt-1' } })
      const out = await processDeliveryWebhook(deps, params(validEvent))
      expect(out).toEqual({ ok: true, duplicate: true, eventId: 'evt-1' })
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
