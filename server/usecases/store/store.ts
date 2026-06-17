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
  type CheckoutInput,
  cloudCreditBalanceResponseSchema,
  cloudCreditLedgerResponseSchema,
  cloudOrderQuotaChangeSchema,
  cloudOrderSchema,
  type DiscountQuoteInput,
  discountQuoteSchema,
  type RedeemGiftCardInput,
  redeemGiftCardResponseSchema,
} from '@shared/schemas'
import type { CloudStoreTarget } from '@shared/types'
import type { z } from 'zod'
import {
  billingPortalSessionResponseSchema,
  type CloudClient,
  commerceProductSchema,
  paymentCreateResponseSchema,
  productListResponseSchema,
} from 'zpan-cloud-sdk'
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

export type CloudStoreDeps = {
  cloudStore: CloudStoreRepo
  licensingCloud: LicensingCloudGateway
  quota: QuotaRepo
}

// A bound Cloud commerce client plus the store it targets. Every storefront
// proxy threads this through a request callback.
export type BoundCloudClient = { client: CloudClient; storeId: string }

type CloudError = { error: string }

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
  if (!response.ok) throw new Error(cloudErrorCode(data) ?? `cloud_request_failed_${response.status}`)
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
    return { error: (error as Error).message }
  }
}

function isCloudError(result: unknown): result is CloudError {
  return Boolean(result && typeof result === 'object' && 'error' in result)
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
export type WebhookOutcome = { ok: true; duplicate: boolean; eventId: string } | { ok: false; error: AppError }

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
    return { ok: true, duplicate: result.duplicate, eventId: result.eventId }
  } catch (error) {
    return { ok: false, error: badRequest((error as Error).message) }
  }
}
