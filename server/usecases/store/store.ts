// The cloud store resource usecase. Owns every business decision behind the
// /api/store routes — the storefront (browse packages/credits/targets, checkout,
// orders, billing portal, credit balance/ledger/redemptions, discount quotes) and
// the cloud delivery webhook (event-token verification + idempotent quota
// fulfillment). All CloudStoreRepo / LicensingCloudGateway / QuotaRepo access and
// the cloud-proxy plumbing (bound client, request timeout, response unwrapping)
// live here, so the http handlers only read request input (raw body, headers,
// origin, cloud base url), call these functions, and serialize the outcome.
//
// The storefront functions are thin proxies onto the bound Cloud commerce API:
// each first resolves the bound store (returning `binding_missing` when unbound),
// then issues the Cloud request and surfaces failures as `cloud_error`. The
// webhook function verifies the signed event token (the decision lives here; the
// handler extracts the raw token/body/headers) and then defers to the repo for
// idempotent fulfillment.

import {
  type CapacityPurchaseResult,
  type CheckoutInput,
  type CloudOrderQuotaChange,
  cloudCreditBalanceResponseSchema,
  cloudCreditLedgerResponseSchema,
  cloudOrderQuotaChangeSchema,
  cloudOrderSchema,
  type DiscountQuoteInput,
  discountQuoteSchema,
  type RedeemGiftCardInput,
  redeemGiftCardResponseSchema,
  type X402PaymentRequired,
} from '@shared/schemas'
import type { CloudStoreTarget } from '@shared/types'
import type { z } from 'zod'
import {
  billingPortalSessionResponseSchema,
  type CloudClient,
  type CommerceProduct,
  commerceProductSchema,
  createX402PaymentAttempt,
  getX402PaymentAttempt,
  paymentCreateResponseSchema,
  productListResponseSchema,
  settleX402PaymentAttempt,
  storePublicationSchema,
  triggerX402PaymentAttemptFulfillment,
  verifyX402PaymentAttempt,
  x402PaymentAttemptSchema,
  x402QuoteCreateResponseSchema,
  x402ReceiverSchema,
} from 'zpan-cloud-sdk'
import type { Deps } from '../deps'
import {
  AppError,
  badGateway,
  badRequest,
  type CloudStoreRepo,
  conflict,
  forbidden,
  type LicensingCloudGateway,
  notFound,
  type QuotaRepo,
  rateLimited,
} from '../ports'
import { verifyCloudEventToken } from '../site/licensing'

// The Cloud commerce response schemas. Aliased to keep call sites readable; the
// matching aliases in cloud-store-helpers serve the orders helper + tests.
const cloudPackageResponseSchema = commerceProductSchema
const cloudPackageListResponseSchema = productListResponseSchema
const cloudOrderResponseSchema = cloudOrderSchema
const cloudCheckoutResponseSchema = paymentCreateResponseSchema
const cloudBillingPortalSessionResponseSchema = billingPortalSessionResponseSchema
const cloudDiscountQuoteResponseSchema = discountQuoteSchema

const CLOUD_STORE_REQUEST_TIMEOUT_MS = 10_000
const X402_ORDER_CLAIM_TIMEOUT_MS = 30_000

export type CloudStoreDeps = {
  cloudStore: CloudStoreRepo
  licensingCloud: LicensingCloudGateway
  quota: QuotaRepo
}

// A bound Cloud commerce client plus the store it targets. Every storefront
// proxy threads this through a request callback.
export type BoundCloudClient = { client: CloudClient; storeId: string }

type CloudError = { error: string; status?: number }

class CloudResponseError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message)
  }
}

// Storefront proxy outcomes. An unbound store renders 403 (`forbidden`); an
// upstream Cloud failure or malformed body renders 502 (`badGateway`). Each
// endpoint layers its own pre-cloud guards on top.
export type StorefrontReadOutcome<T> = { ok: true; value: T } | { ok: false; error: AppError }

// ─── Cloud-proxy plumbing (port access) ──────────────────────────────────────

// Builds a refresh-token-authenticated Cloud client for the bound store. Throws
// Error('quota_store_binding_missing') (via the repo) when no bound store exists.
export async function buildBoundCloudClient(
  deps: Pick<CloudStoreDeps, 'cloudStore' | 'licensingCloud'>,
  cloudBaseUrl: string,
): Promise<BoundCloudClient> {
  const binding = await deps.cloudStore.getCloudStoreBinding()
  return {
    client: deps.licensingCloud.createBoundCloudClient(cloudBaseUrl, binding.refreshToken),
    storeId: binding.storeId,
  }
}

// Resolves whether the store is bound. `quota_store_binding_missing` is the only
// expected failure (surfaced as 403); any other error propagates.
export async function getStoreReadiness(
  deps: Pick<CloudStoreDeps, 'cloudStore'>,
): Promise<{ ready: true } | { ready: false; error: 'quota_store_binding_missing' }> {
  try {
    await deps.cloudStore.getCloudStoreBinding()
    return { ready: true }
  } catch (error) {
    const message = (error as Error).message
    if (message === 'quota_store_binding_missing') return { ready: false, error: message }
    throw error
  }
}

// Races a Cloud request against a fixed timeout so a hung upstream never wedges a
// request. Pure (no deps) — kept here as the home of the cloud-proxy plumbing and
// re-exported through cloud-store-helpers for the orders helper.
export async function withCloudRequestTimeout<T>(request: Promise<T>): Promise<T> {
  let timeout: ReturnType<typeof setTimeout> | undefined
  try {
    return await Promise.race([
      request,
      new Promise<never>((_, reject) => {
        timeout = setTimeout(() => reject(new Error('cloud_request_timeout')), CLOUD_STORE_REQUEST_TIMEOUT_MS)
      }),
    ])
  } finally {
    if (timeout) clearTimeout(timeout)
  }
}

// Normalizes a Cloud commerce response: 204 → null, non-2xx → throw the cloud
// error code, otherwise unwrap a `{ data }` envelope and validate against the
// schema. Pure (no deps).
export async function unwrapCloudResponse<T, U = T>(
  response: { status: number; ok: boolean; json(): Promise<T> },
  responseSchema?: z.ZodType<U>,
): Promise<U> {
  if (response.status === 204) return null as U
  const data = await response.json().catch(() => null)
  if (!response.ok) {
    throw new CloudResponseError(response.status, cloudErrorCode(data) ?? `cloud_request_failed_${response.status}`)
  }
  const payload = data && typeof data === 'object' && 'data' in data ? data.data : data
  if (!responseSchema) return payload as U
  const parsed = responseSchema.safeParse(payload)
  if (!parsed.success) throw new Error('invalid_cloud_response')
  return parsed.data
}

function cloudErrorCode(data: unknown): string | null {
  if (!data || typeof data !== 'object' || !('error' in data)) return null
  const error = data.error
  if (typeof error === 'string') return error
  if (error && typeof error === 'object' && 'code' in error && typeof error.code === 'string') return error.code
  return null
}

// Runs a request against the bound Cloud client under the timeout, turning any
// thrown error into a flat `{ error }` the handler maps to 502.
async function cloudRequest<T>(
  deps: Pick<CloudStoreDeps, 'cloudStore' | 'licensingCloud'>,
  cloudBaseUrl: string,
  request: (context: BoundCloudClient) => Promise<T>,
): Promise<T | CloudError> {
  try {
    return await withCloudRequestTimeout(request(await buildBoundCloudClient(deps, cloudBaseUrl)))
  } catch (error) {
    return {
      error: (error as Error).message,
      ...(error instanceof CloudResponseError ? { status: error.status } : {}),
    }
  }
}

function isCloudError(result: unknown): result is CloudError {
  return Boolean(result && typeof result === 'object' && 'error' in result)
}

function capacityPurchaseCloudError(error: CloudError): AppError {
  if (error.error === 'capacity_offer_not_found') {
    return badRequest('Invalid capacity offer', 'CAPACITY_OFFER_NOT_FOUND')
  }
  const reason = error.error.toUpperCase()
  if (error.status === 400 || error.status === 422) return badRequest(error.error, reason)
  if (error.status === 404 || error.status === 409) return conflict(error.error, reason)
  return badGateway(error.error)
}

// ─── Storefront reads ────────────────────────────────────────────────────────

// Fetches active store_item products and keeps only those whose deliverable
// matches the requested kind (plans for /packages, credits for /credits/products).
async function listDeliverables(
  deps: Pick<CloudStoreDeps, 'cloudStore' | 'licensingCloud'>,
  cloudBaseUrl: string,
  deliverableType: 'zpan.plan' | 'zpan.credits',
): Promise<StorefrontReadOutcome<{ items: unknown[]; total: number }>> {
  const ready = await getStoreReadiness(deps)
  if (!ready.ready) return { ok: false, error: forbidden(ready.error) }
  const result = await cloudRequest(deps, cloudBaseUrl, async ({ client, storeId }) =>
    unwrapCloudResponse(
      await client.stores[':storeId'].products.$get({
        param: { storeId },
        query: { type: 'store_item', limit: '100', status: 'active' },
      }),
      cloudPackageListResponseSchema,
    ),
  )
  if (isCloudError(result)) return { ok: false, error: badGateway(result.error) }
  const items = result.items.filter((item) => item.metadata.deliverable.type === deliverableType)
  return { ok: true, value: { ...result, items, total: items.length } }
}

export interface CapacityOffer {
  resourceId: string
  productId: string
  priceId: string
  name: string
  description: string | null
  storageBytes: number
  amount: number
  currency: string
  interval: string | null
  intervalCount: number | null
  purchaseUrl: string
}

export async function listCapacityOffers(
  deps: CloudStoreDeps,
  cloudBaseUrl: string,
  params: { orgId: string; requestedBytes: number },
): Promise<StorefrontReadOutcome<CapacityOffer[]>> {
  const packages = await listPackages(deps, cloudBaseUrl)
  if (!packages.ok) return packages
  const publication = await cloudRequest(deps, cloudBaseUrl, async ({ client, storeId }) =>
    unwrapCloudResponse(
      await client.stores[':storeId'].publication.$get({ param: { storeId } }),
      storePublicationSchema,
    ),
  )
  if (isCloudError(publication)) return { ok: false, error: badGateway(publication.error) }
  const quota = await deps.quota.getEffectiveQuota(params.orgId)
  const capacityOutsideCurrentPlan = Math.max(0, quota.quota - (quota.currentPlan?.storageBytes ?? 0))
  const minimumStorageBytes = Math.max(1, quota.used + params.requestedBytes - capacityOutsideCurrentPlan)
  const offers = (packages.value.items as CommerceProduct[]).flatMap((product) => {
    const storageBytes = product.metadata.deliverable.storageBytes
    if (typeof storageBytes !== 'number' || !Number.isSafeInteger(storageBytes) || storageBytes < minimumStorageBytes) {
      return []
    }
    return product.prices.flatMap((price) => {
      if (!price.id || price.recurring?.usageType === 'metered') return []
      const resource = publication.resources.find(
        (candidate) =>
          candidate.productId === product.id &&
          candidate.priceId === price.id &&
          candidate.status !== 'disabled' &&
          candidate.capabilities.includes('storage.capacity.purchase'),
      )
      if (!resource) return []
      return [
        {
          resourceId: resource.resourceId,
          productId: product.id,
          priceId: price.id,
          name: product.name,
          description: product.description,
          storageBytes,
          amount: price.amount,
          currency: price.currency,
          interval: price.recurring?.interval ?? null,
          intervalCount: price.recurring?.intervalCount ?? null,
          purchaseUrl: resource.postResourceUrl,
        },
      ]
    })
  })
  return { ok: true, value: offers }
}

export async function describeCapacityRequirement(
  deps: CloudStoreDeps,
  cloudBaseUrl: string,
  params: { orgId: string; requestedBytes: number },
): Promise<
  StorefrontReadOutcome<{
    requestedBytes: number
    usedBytes: number
    quotaBytes: number
    offers: CapacityOffer[]
  }>
> {
  const offers = await listCapacityOffers(deps, cloudBaseUrl, params)
  if (!offers.ok) return offers
  const quota = await deps.quota.getEffectiveQuota(params.orgId)
  return {
    ok: true,
    value: {
      requestedBytes: params.requestedBytes,
      usedBytes: quota.used,
      quotaBytes: quota.quota,
      offers: offers.value,
    },
  }
}

export type CapacityPurchaseOutcome =
  | {
      ok: true
      kind: 'payment_required'
      paymentRequired: X402PaymentRequired
      paymentRequiredHeader: string
    }
  | {
      ok: true
      kind: 'pending' | 'delivered'
      purchase: CapacityPurchaseResult
      paymentResponseHeader: string | null
    }
  | { ok: false; error: AppError }

async function capacityQuoteRetryKey(idempotencyKey: string, expiredAttemptId: string): Promise<string> {
  const input = new TextEncoder().encode(`${idempotencyKey}:${expiredAttemptId}`)
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', input))
  return `x402-retry:${Array.from(digest, (byte) => byte.toString(16).padStart(2, '0')).join('')}`
}

function capacityAttemptExpired(attempt: z.infer<typeof x402PaymentAttemptSchema>, now = new Date()): boolean {
  return (
    attempt.status === 'expired' ||
    (attempt.status === 'quoted' && new Date(attempt.expiresAt).getTime() <= now.getTime())
  )
}

export async function purchaseCapacity(
  deps: CloudStoreDeps & Pick<Deps, 'x402CapacityPurchases'>,
  cloudBaseUrl: string,
  params: {
    userId: string
    orgId: string
    origin: string
    resourceId: string
    requestHash: string
    idempotencyKey: string
    paymentSignature: string | null
  },
): Promise<CapacityPurchaseOutcome> {
  const ready = await getStoreReadiness(deps)
  if (!ready.ready) return { ok: false, error: forbidden(ready.error) }

  const context = await cloudRequest(deps, cloudBaseUrl, async (bound) => {
    const publication = await unwrapCloudResponse(
      await bound.client.stores[':storeId'].publication.$get({ param: { storeId: bound.storeId } }),
      storePublicationSchema,
    )
    const resource = publication.resources.find(
      (candidate) =>
        candidate.resourceId === params.resourceId &&
        candidate.status !== 'disabled' &&
        candidate.capabilities.includes('storage.capacity.purchase'),
    )
    if (!resource) throw new Error('capacity_offer_not_found')
    const { productId, priceId } = resource
    const product = await unwrapCloudResponse(
      await bound.client.stores[':storeId'].products[':productId'].$get({
        param: { storeId: bound.storeId, productId },
      }),
      cloudPackageResponseSchema,
    )
    const storageBytes = product.metadata.deliverable.storageBytes
    const price = product.prices.find((item) => item.id === priceId && item.recurring?.usageType !== 'metered')
    if (
      product.metadata.deliverable.type !== 'zpan.plan' ||
      typeof storageBytes !== 'number' ||
      !Number.isSafeInteger(storageBytes) ||
      storageBytes <= 0 ||
      !price
    ) {
      throw new Error('capacity_offer_not_found')
    }
    const receiver = await unwrapCloudResponse(
      await bound.client.stores[':storeId']['payment-methods'].x402.receiver.$get({
        param: { storeId: bound.storeId },
      }),
      x402ReceiverSchema,
    )
    if (receiver.status !== 'active') throw new Error('x402_receiver_not_active')
    return { ...bound, productId, priceId, product, price, receiver }
  })
  if (isCloudError(context)) return { ok: false, error: capacityPurchaseCloudError(context) }

  let intent = await deps.x402CapacityPurchases.get(params.orgId, params.resourceId, params.requestHash)
  if (!intent) {
    try {
      intent = await deps.x402CapacityPurchases.create({
        orgId: params.orgId,
        resourceId: params.resourceId,
        requestHash: params.requestHash,
        idempotencyKey: params.idempotencyKey,
      })
      if (!intent) {
        return {
          ok: false,
          error: rateLimited('Too many pending capacity purchases', 3600),
        }
      }
    } catch {
      intent = await deps.x402CapacityPurchases.get(params.orgId, params.resourceId, params.requestHash)
      if (!intent) {
        return { ok: false, error: conflict('Purchase request conflict', 'X402_PURCHASE_CONFLICT') }
      }
    }
  }
  // The request hash is the stable recovery identity. A caller may not know the
  // creation key after an Agent handoff or an interrupted initialization.
  let cloudOrderId = intent.cloudOrderId
  if (!cloudOrderId) {
    const claimed = await deps.x402CapacityPurchases.claimCloudOrder(
      intent.id,
      new Date(Date.now() - X402_ORDER_CLAIM_TIMEOUT_MS),
    )
    if (!claimed) {
      const currentIntent = await deps.x402CapacityPurchases.get(params.orgId, params.resourceId, params.requestHash)
      cloudOrderId = currentIntent?.cloudOrderId ?? null
      if (!cloudOrderId) {
        return {
          ok: false,
          error: conflict('Purchase initialization is in progress', 'X402_PURCHASE_IN_PROGRESS'),
        }
      }
    }
  }
  if (!cloudOrderId) {
    const customerLabel = await deps.cloudStore.getCustomerLabel(params.userId, params.orgId)
    const order = await cloudRequest(deps, cloudBaseUrl, async ({ client, storeId }) =>
      unwrapCloudResponse(
        await client.stores[':storeId'].orders.$post({
          param: { storeId },
          json: {
            items: [{ productId: context.productId, priceId: context.priceId, quantity: 1 }],
            currency: context.price.currency,
            idempotencyKey: `zpan-x402-capacity:${intent.id}`,
            deliveryCallbackUrl: `${params.origin}/api/store/webhook`,
            target: { orgId: params.orgId, customerId: params.orgId, customerLabel },
          },
        }),
        cloudOrderResponseSchema,
      ),
    )
    if (isCloudError(order)) {
      await deps.x402CapacityPurchases.updateCloudState(intent.id, { status: 'created' })
      return { ok: false, error: capacityPurchaseCloudError(order) }
    }
    cloudOrderId = order.id
    await deps.x402CapacityPurchases.updateCloudState(intent.id, {
      cloudOrderId,
      status: 'ordered',
    })
  }

  const createQuote = async (idempotencyKey: string) =>
    cloudRequest(deps, cloudBaseUrl, async ({ client, storeId }) =>
      unwrapCloudResponse(
        await createX402PaymentAttempt(client, {
          storeId,
          orderId: cloudOrderId,
          idempotencyKey,
          requestHash: params.requestHash,
          resourceId: params.resourceId,
          resourceDescription: `Add ${context.product.name} capacity to workspace`,
          network: context.receiver.network,
          asset: context.receiver.asset,
        }),
        x402QuoteCreateResponseSchema,
      ),
    )

  let attempt: z.infer<typeof x402PaymentAttemptSchema>
  let quoteWasReplaced = false
  if (intent.cloudAttemptId) {
    const found = await cloudRequest(deps, cloudBaseUrl, async ({ client, storeId }) =>
      unwrapCloudResponse(
        await getX402PaymentAttempt(client, {
          storeId,
          orderId: cloudOrderId,
          attemptId: intent.cloudAttemptId!,
        }),
        x402PaymentAttemptSchema,
      ),
    )
    if (isCloudError(found)) return { ok: false, error: capacityPurchaseCloudError(found) }
    attempt = found
    if (capacityAttemptExpired(attempt)) {
      const replacement = await createQuote(await capacityQuoteRetryKey(intent.idempotencyKey, attempt.id))
      if (isCloudError(replacement)) return { ok: false, error: capacityPurchaseCloudError(replacement) }
      attempt = replacement
      quoteWasReplaced = true
      await deps.x402CapacityPurchases.updateCloudState(intent.id, {
        cloudOrderId,
        cloudAttemptId: attempt.id,
        status: attempt.status,
        expiresAt: new Date(attempt.expiresAt),
      })
    }
  } else {
    const quoted = await createQuote(params.idempotencyKey)
    if (isCloudError(quoted)) return { ok: false, error: capacityPurchaseCloudError(quoted) }
    attempt = quoted
    await deps.x402CapacityPurchases.updateCloudState(intent.id, {
      cloudOrderId,
      cloudAttemptId: attempt.id,
      status: attempt.status,
      expiresAt: new Date(attempt.expiresAt),
    })
  }

  if (
    quoteWasReplaced ||
    (!params.paymentSignature && attempt.status !== 'verified' && attempt.status !== 'paid_pending_fulfillment')
  ) {
    if (attempt.status !== 'quoted') {
      return terminalCapacityPurchaseOutcome(attempt)
    }
    return {
      ok: true,
      kind: 'payment_required',
      paymentRequired: attempt.paymentRequired,
      paymentRequiredHeader: attempt.paymentRequiredHeader,
    }
  }

  if (attempt.status === 'quoted') {
    const verified = await cloudRequest(deps, cloudBaseUrl, async ({ client, storeId }) =>
      unwrapCloudResponse(
        await verifyX402PaymentAttempt(client, {
          storeId,
          orderId: cloudOrderId,
          attemptId: attempt.id,
          paymentSignature: params.paymentSignature!,
          requestHash: params.requestHash,
        }),
        x402PaymentAttemptSchema,
      ),
    )
    if (isCloudError(verified)) return { ok: false, error: capacityPurchaseCloudError(verified) }
    attempt = verified
  }

  if (attempt.status === 'verified') {
    const settled = await cloudRequest(deps, cloudBaseUrl, async ({ client, storeId }) =>
      unwrapCloudResponse(
        await settleX402PaymentAttempt(client, {
          storeId,
          orderId: cloudOrderId,
          attemptId: attempt.id,
          requestHash: params.requestHash,
        }),
        x402PaymentAttemptSchema,
      ),
    )
    if (isCloudError(settled)) return { ok: false, error: capacityPurchaseCloudError(settled) }
    attempt = settled
  }

  if (attempt.status === 'paid_pending_fulfillment') {
    const delivered = await cloudRequest(deps, cloudBaseUrl, async ({ client, storeId }) =>
      unwrapCloudResponse(
        await triggerX402PaymentAttemptFulfillment(client, {
          storeId,
          orderId: cloudOrderId,
          attemptId: attempt.id,
          deliveryCallbackUrl: `${params.origin}/api/store/webhook`,
        }),
        x402PaymentAttemptSchema,
      ),
    )
    if (isCloudError(delivered)) return { ok: false, error: capacityPurchaseCloudError(delivered) }
    attempt = delivered
  }

  await deps.x402CapacityPurchases.updateCloudState(intent.id, {
    cloudOrderId,
    cloudAttemptId: attempt.id,
    status: attempt.status,
    expiresAt: new Date(attempt.expiresAt),
  })
  return terminalCapacityPurchaseOutcome(attempt)
}

function terminalCapacityPurchaseOutcome(attempt: z.infer<typeof x402PaymentAttemptSchema>): CapacityPurchaseOutcome {
  if (attempt.status === 'failed' || attempt.status === 'canceled' || attempt.status === 'expired') {
    return {
      ok: false,
      error: conflict('Payment was not completed', `X402_PAYMENT_${attempt.status.toUpperCase()}`),
    }
  }
  if (!attempt.resourceId) {
    return { ok: false, error: badGateway('Cloud capacity purchase response is missing its resource identity') }
  }
  return {
    ok: true,
    kind: attempt.status === 'delivered' ? 'delivered' : 'pending',
    purchase: {
      attemptId: attempt.id,
      orderId: attempt.orderId,
      resourceId: attempt.resourceId,
      requestHash: attempt.requestHash,
      status: attempt.status === 'delivered' ? 'delivered' : 'pending',
    },
    paymentResponseHeader: attempt.settlementResponseHeader,
  }
}

export function listPackages(deps: Pick<CloudStoreDeps, 'cloudStore' | 'licensingCloud'>, cloudBaseUrl: string) {
  return listDeliverables(deps, cloudBaseUrl, 'zpan.plan')
}

export function listCreditProducts(deps: Pick<CloudStoreDeps, 'cloudStore' | 'licensingCloud'>, cloudBaseUrl: string) {
  return listDeliverables(deps, cloudBaseUrl, 'zpan.credits')
}

export async function listTargets(
  deps: Pick<CloudStoreDeps, 'cloudStore'>,
  userId: string,
): Promise<StorefrontReadOutcome<{ items: CloudStoreTarget[]; total: number }>> {
  const ready = await getStoreReadiness(deps)
  if (!ready.ready) return { ok: false, error: forbidden(ready.error) }
  const items = await deps.cloudStore.getAccessibleTargets(userId)
  return { ok: true, value: { items, total: items.length } }
}

// Credit balance / ledger / redemptions / discount quotes / billing portal are
// owner-scoped or org-scoped proxies whose only org guard (no active org) is
// enforced by the handler before calling. They share the binding→cloud shape.

export async function getCreditBalance(
  deps: Pick<CloudStoreDeps, 'cloudStore' | 'licensingCloud'>,
  cloudBaseUrl: string,
  orgId: string,
): Promise<StorefrontReadOutcome<unknown>> {
  const ready = await getStoreReadiness(deps)
  if (!ready.ready) return { ok: false, error: forbidden(ready.error) }
  const result = await cloudRequest(deps, cloudBaseUrl, async ({ client, storeId }) =>
    unwrapCloudResponse(
      await client.stores[':storeId']['credit-accounts'][':customerId'].balance.$get({
        param: { storeId, customerId: orgId },
      }),
      cloudCreditBalanceResponseSchema,
    ),
  )
  if (isCloudError(result)) return { ok: false, error: badGateway(result.error) }
  return { ok: true, value: result }
}

export async function getCreditLedger(
  deps: Pick<CloudStoreDeps, 'cloudStore' | 'licensingCloud'>,
  cloudBaseUrl: string,
  orgId: string,
): Promise<StorefrontReadOutcome<unknown>> {
  const ready = await getStoreReadiness(deps)
  if (!ready.ready) return { ok: false, error: forbidden(ready.error) }
  const result = await cloudRequest(deps, cloudBaseUrl, async ({ client, storeId }) =>
    unwrapCloudResponse(
      await client.stores[':storeId']['credit-accounts'][':customerId']['ledger-entries'].$get({
        param: { storeId, customerId: orgId },
        query: {},
      }),
      cloudCreditLedgerResponseSchema,
    ),
  )
  if (isCloudError(result)) return { ok: false, error: badGateway(result.error) }
  return { ok: true, value: result }
}

export async function redeemGiftCard(
  deps: Pick<CloudStoreDeps, 'cloudStore' | 'licensingCloud'>,
  cloudBaseUrl: string,
  params: { orgId: string; input: RedeemGiftCardInput },
): Promise<StorefrontReadOutcome<unknown>> {
  const ready = await getStoreReadiness(deps)
  if (!ready.ready) return { ok: false, error: forbidden(ready.error) }
  const result = await cloudRequest(deps, cloudBaseUrl, async ({ client, storeId }) =>
    unwrapCloudResponse(
      await client.stores[':storeId']['credit-accounts'][':customerId'].redemptions.$post({
        param: { storeId, customerId: params.orgId },
        json: { codes: [params.input.code] },
      }),
      redeemGiftCardResponseSchema,
    ),
  )
  if (isCloudError(result)) return { ok: false, error: badGateway(result.error) }
  return { ok: true, value: result }
}

export async function getDiscountQuote(
  deps: Pick<CloudStoreDeps, 'cloudStore' | 'licensingCloud'>,
  cloudBaseUrl: string,
  input: DiscountQuoteInput,
): Promise<StorefrontReadOutcome<unknown>> {
  const ready = await getStoreReadiness(deps)
  if (!ready.ready) return { ok: false, error: forbidden(ready.error) }
  const result = await cloudRequest(deps, cloudBaseUrl, async ({ client, storeId }) =>
    unwrapCloudResponse(
      await client.stores[':storeId']['discount-quotes'].$post({ param: { storeId }, json: input }),
      cloudDiscountQuoteResponseSchema,
    ),
  )
  if (isCloudError(result)) return { ok: false, error: badGateway(result.error) }
  return { ok: true, value: result }
}

export async function createBillingPortalSession(
  deps: Pick<CloudStoreDeps, 'cloudStore' | 'licensingCloud'>,
  cloudBaseUrl: string,
  params: { orgId: string; origin: string },
): Promise<StorefrontReadOutcome<unknown>> {
  const ready = await getStoreReadiness(deps)
  if (!ready.ready) return { ok: false, error: forbidden(ready.error) }
  const result = await cloudRequest(deps, cloudBaseUrl, async ({ client, storeId }) =>
    unwrapCloudResponse(
      await client.stores[':storeId'].billing['portal-sessions'].$post({
        param: { storeId },
        json: { customerId: params.orgId, returnUrl: `${params.origin}/storage` },
      }),
      cloudBillingPortalSessionResponseSchema,
    ),
  )
  if (isCloudError(result)) return { ok: false, error: badGateway(result.error) }
  return { ok: true, value: result }
}

// ─── Checkout ────────────────────────────────────────────────────────────────

export type CheckoutOutcome = { ok: true; value: unknown } | { ok: false; error: AppError }

const CHECKOUT_CURRENCY = 'usd'

// Creates a Cloud order + payment for a package. Selects the matching USD,
// non-metered price; recurring prices additionally require the workspace to have
// no existing subscription plan. The delivery callback + return URLs are pinned
// to the trusted instance origin (passed in by the handler).
export async function createCheckout(
  deps: CloudStoreDeps,
  cloudBaseUrl: string,
  params: { userId: string; orgId: string; origin: string; input: CheckoutInput },
): Promise<CheckoutOutcome> {
  const ready = await getStoreReadiness(deps)
  if (!ready.ready) return { ok: false, error: forbidden(ready.error) }
  const { userId, orgId, origin, input } = params

  const product = await cloudRequest(deps, cloudBaseUrl, async ({ client, storeId }) =>
    unwrapCloudResponse(
      await client.stores[':storeId'].products[':productId'].$get({
        param: { storeId, productId: input.packageId },
      }),
      cloudPackageResponseSchema,
    ),
  )
  if (isCloudError(product)) return { ok: false, error: badGateway(product.error) }

  const price = input.priceId
    ? product.prices.find(
        (item) =>
          item.id === input.priceId && item.currency === CHECKOUT_CURRENCY && item.recurring?.usageType !== 'metered',
      )
    : product.prices.find((item) => item.currency === CHECKOUT_CURRENCY && item.recurring?.usageType !== 'metered')
  if (!price) return { ok: false, error: badRequest('Package price missing', 'PACKAGE_PRICE_MISSING') }

  if (price.recurring) {
    const quota = await deps.quota.getEffectiveQuota(orgId)
    if (quota.currentPlan?.subscription)
      return { ok: false, error: conflict('Workspace plan already exists', 'WORKSPACE_PLAN_EXISTS') }
  }

  const customerLabel = await deps.cloudStore.getCustomerLabel(userId, orgId)
  const order = await cloudRequest(deps, cloudBaseUrl, async ({ client, storeId }) =>
    unwrapCloudResponse(
      await client.stores[':storeId'].orders.$post({
        param: { storeId },
        json: {
          items: [{ productId: input.packageId, priceId: price.id, quantity: 1 }],
          currency: CHECKOUT_CURRENCY,
          deliveryCallbackUrl: `${origin}/api/store/webhook`,
          target: { orgId, customerId: orgId, customerLabel },
        },
      }),
      cloudOrderResponseSchema,
    ),
  )
  if (isCloudError(order)) return { ok: false, error: badGateway(order.error) }

  const payment = await cloudRequest(deps, cloudBaseUrl, async ({ client, storeId }) =>
    unwrapCloudResponse(
      await client.stores[':storeId'].orders[':orderId'].payments.$post({
        param: { storeId, orderId: order.id },
        json: {
          successUrl: `${origin}/storage`,
          cancelUrl: `${origin}/storage`,
          ...(input.promotionCode ? { promotionCode: input.promotionCode } : {}),
        },
      }),
      cloudCheckoutResponseSchema,
    ),
  )
  if (isCloudError(payment)) return { ok: false, error: badGateway(payment.error) }
  return { ok: true, value: payment }
}

// ─── Orders (continue payment / cancel) ──────────────────────────────────────

// The store-binding gate (403) is enforced by the handler before these run —
// for the order routes the original checks binding before the org/orderId guards,
// so the handler owns that ordering. These assume the store is bound.
export type OrderActionOutcome = { ok: true; value: unknown } | { ok: false; error: AppError }

function fetchOrder(
  deps: Pick<CloudStoreDeps, 'cloudStore' | 'licensingCloud'>,
  cloudBaseUrl: string,
  orderId: string,
) {
  return cloudRequest(deps, cloudBaseUrl, async ({ client, storeId }) =>
    unwrapCloudResponse(
      await client.stores[':storeId'].orders[':orderId'].$get({ param: { storeId, orderId } }),
      cloudOrderResponseSchema,
    ),
  )
}

function orderBelongsToTarget(target: Record<string, unknown> | null, orgId: string): boolean {
  return target?.orgId === orgId || target?.customerId === orgId
}

// Continues payment on an existing order, after confirming the order belongs to
// the caller's org. Empty `orderId` → not_found (404).
export async function continueOrderPayment(
  deps: Pick<CloudStoreDeps, 'cloudStore' | 'licensingCloud'>,
  cloudBaseUrl: string,
  params: { orgId: string; orderId: string | undefined; origin: string },
): Promise<OrderActionOutcome> {
  if (!params.orderId) return { ok: false, error: notFound('Order not found') }
  const orderId = params.orderId

  const order = await fetchOrder(deps, cloudBaseUrl, orderId)
  if (isCloudError(order)) return { ok: false, error: badGateway(order.error) }
  if (!orderBelongsToTarget(order.target, params.orgId)) return { ok: false, error: forbidden() }

  const result = await cloudRequest(deps, cloudBaseUrl, async ({ client, storeId }) =>
    unwrapCloudResponse(
      await client.stores[':storeId'].orders[':orderId'].payments.$post({
        param: { storeId, orderId },
        json: { successUrl: `${params.origin}/storage`, cancelUrl: `${params.origin}/storage` },
      }),
      cloudCheckoutResponseSchema,
    ),
  )
  if (isCloudError(result)) return { ok: false, error: badGateway(result.error) }
  return { ok: true, value: result }
}

export async function cancelOrder(
  deps: Pick<CloudStoreDeps, 'cloudStore' | 'licensingCloud'>,
  cloudBaseUrl: string,
  params: { orgId: string; orderId: string | undefined; status: 'canceled' },
): Promise<OrderActionOutcome> {
  if (!params.orderId) return { ok: false, error: notFound('Order not found') }
  const orderId = params.orderId

  const order = await fetchOrder(deps, cloudBaseUrl, orderId)
  if (isCloudError(order)) return { ok: false, error: badGateway(order.error) }
  if (!orderBelongsToTarget(order.target, params.orgId)) return { ok: false, error: forbidden() }

  const result = await cloudRequest(deps, cloudBaseUrl, async ({ client, storeId }) =>
    unwrapCloudResponse(
      await client.stores[':storeId'].orders[':orderId'].$patch({
        param: { storeId, orderId },
        json: { status: params.status },
      }),
      cloudOrderResponseSchema,
    ),
  )
  if (isCloudError(result)) return { ok: false, error: badGateway(result.error) }
  return { ok: true, value: result }
}

// ─── Delivery webhook ────────────────────────────────────────────────────────

// Why a cloud-delivery webhook was rejected. A failed/mismatched event token
// renders 401 (`INVALID_EVENT_TOKEN`); a non-JSON or non-quota-change body renders
// 400 (`INVALID_PAYLOAD`); a fulfillment failure renders 400 carrying the error
// message.
export type WebhookOutcome =
  | { ok: true; duplicate: boolean; eventId: string; receipt: CloudOrderQuotaChange }
  | { ok: false; error: AppError }

const invalidEventToken = () => new AppError(401, 'Invalid event token', { reason: 'INVALID_EVENT_TOKEN' })

// Full webhook decision over the already-read request. Reads the binding, verifies
// the event token, validates the parsed body, cross-checks the body eventId
// against the token, then defers to the repo for idempotent fulfillment.
export async function processDeliveryWebhook(
  deps: Pick<CloudStoreDeps, 'cloudStore'>,
  params: {
    cloudBaseUrl: string
    eventToken: string
    rawPayload: string
    payloadHash: string
    body: unknown
  },
): Promise<WebhookOutcome> {
  const binding = await deps.cloudStore.getCloudStoreBinding()
  const eventAuth = verifyCloudEventToken(params.eventToken, {
    cloudBaseUrl: params.cloudBaseUrl,
    instanceId: binding.instanceId,
    boundLicenseId: binding.boundLicenseId,
    payloadHash: params.payloadHash,
  })
  if (!eventAuth) return { ok: false, error: invalidEventToken() }

  if (!params.body) return { ok: false, error: badRequest('Invalid payload', 'INVALID_PAYLOAD') }
  const parsed = cloudOrderQuotaChangeSchema.safeParse(params.body)
  if (!parsed.success) return { ok: false, error: badRequest('Invalid payload', 'INVALID_PAYLOAD') }
  if (parsed.data.eventId !== eventAuth.eventId) return { ok: false, error: invalidEventToken() }

  try {
    const result = await deps.cloudStore.processCloudOrderQuotaChange(
      parsed.data,
      params.rawPayload,
      params.payloadHash,
    )
    return { ok: true, duplicate: result.duplicate, eventId: result.eventId, receipt: parsed.data }
  } catch (error) {
    return { ok: false, error: badRequest((error as Error).message) }
  }
}
