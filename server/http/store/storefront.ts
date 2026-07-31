import { OpenAPIHono, z } from '@hono/zod-openapi'
import { AuthorizationScope } from '@shared/authorization'
import { checkoutInputSchema, discountQuoteInputSchema, redeemGiftCardInputSchema } from '@shared/schemas'
import type { Env } from '../../middleware/platform'
import { requireFeature } from '../../middleware/require-feature'
import { badGateway, badRequest, forbidden } from '../../usecases/ports'
import {
  cancelOrder,
  continueOrderPayment,
  createBillingPortalSession,
  createCheckout,
  getCreditBalance,
  getCreditLedger,
  getDiscountQuote,
  getStoreReadiness,
  listCreditProducts,
  listPackages,
  listTargets,
  purchaseCapacity,
  redeemGiftCard,
} from '../../usecases/store/store'
import { authRoute, errorResponse, jsonBody, jsonContent } from '../openapi'
import { cloudStoreOrdersQuerySchema, getCloudBaseUrl } from './helpers'
import { getCloudOrders, getInstanceOrigin } from './shared'

// Storefront responses are passed through verbatim from the upstream cloud
// commerce API, whose payloads are owned by that service. They are documented as
// opaque objects rather than mirrored field-for-field here.
const cloudValue = z.unknown().openapi('CloudStoreValue')
const cloudBody = (description: string) => jsonContent(cloudValue, description)
const capacityPurchaseInputSchema = z.object({
  requestHash: z.string().min(1).max(256),
  idempotencyKey: z.string().min(1).max(200),
})

const packagesRoute = authRoute(
  { scopes: [AuthorizationScope.STORE_READ] },
  {
    operationId: 'listStorePackages',
    summary: 'List store packages',
    tags: ['Store'],
    method: 'get',
    path: '/packages',
    middleware: [requireFeature('quota_store')] as const,
    responses: {
      200: cloudBody('Packages'),
      403: errorResponse('License not bound'),
      502: errorResponse('Cloud error'),
    },
  },
)

const creditProductsRoute = authRoute(
  { scopes: [AuthorizationScope.STORE_READ] },
  {
    operationId: 'listCreditProducts',
    summary: 'List credit products',
    tags: ['Store'],
    method: 'get',
    path: '/credits/products',
    middleware: [requireFeature('quota_store')] as const,
    responses: {
      200: cloudBody('Credit products'),
      403: errorResponse('License not bound'),
      502: errorResponse('Cloud error'),
    },
  },
)

const targetsRoute = authRoute(
  { scopes: [AuthorizationScope.STORE_READ] },
  {
    operationId: 'listStoreTargets',
    summary: 'List store targets',
    tags: ['Store'],
    method: 'get',
    path: '/targets',
    middleware: [requireFeature('quota_store')] as const,
    responses: {
      200: cloudBody('Targets'),
      403: errorResponse('License not bound'),
      502: errorResponse('Cloud error'),
    },
  },
)

const creditsRoute = authRoute(
  { scopes: [AuthorizationScope.STORE_READ], minTeamRole: 'owner' },
  {
    operationId: 'getCreditBalance',
    summary: 'Get credit balance',
    tags: ['Store'],
    method: 'get',
    path: '/credits',
    middleware: [requireFeature('quota_store')] as const,
    responses: {
      200: cloudBody('Credit balance'),
      400: errorResponse('No active organization'),
      403: errorResponse('License not bound'),
      502: errorResponse('Cloud error'),
    },
  },
)

const ledgerRoute = authRoute(
  { scopes: [AuthorizationScope.STORE_READ], minTeamRole: 'owner' },
  {
    operationId: 'getCreditLedger',
    summary: 'Get credit ledger',
    tags: ['Store'],
    method: 'get',
    path: '/credits/ledger-entries',
    middleware: [requireFeature('quota_store')] as const,
    responses: {
      200: cloudBody('Credit ledger'),
      400: errorResponse('No active organization'),
      403: errorResponse('License not bound'),
      502: errorResponse('Cloud error'),
    },
  },
)

const redeemRoute = authRoute(
  { scopes: [AuthorizationScope.STORE_CREATE], minTeamRole: 'owner' },
  {
    operationId: 'redeemGiftCard',
    summary: 'Redeem a gift card',
    tags: ['Store'],
    method: 'post',
    path: '/credits/redemptions',
    middleware: [requireFeature('quota_store')] as const,
    request: jsonBody(redeemGiftCardInputSchema),
    responses: {
      200: cloudBody('Redemption result'),
      400: errorResponse('No active organization'),
      403: errorResponse('License not bound'),
      502: errorResponse('Cloud error'),
    },
  },
)

const checkoutRoute = authRoute(
  { scopes: [AuthorizationScope.STORE_CREATE], minTeamRole: 'owner' },
  {
    operationId: 'createCheckout',
    summary: 'Create a checkout',
    tags: ['Store'],
    method: 'post',
    path: '/checkouts',
    middleware: [requireFeature('quota_store')] as const,
    request: jsonBody(checkoutInputSchema),
    responses: {
      200: cloudBody('Checkout session'),
      400: errorResponse('Bad request'),
      403: errorResponse('License not bound'),
      409: errorResponse('Workspace plan already exists'),
      502: errorResponse('Cloud error'),
    },
  },
)

const capacityPurchaseRoute = authRoute(
  { scopes: [AuthorizationScope.QUOTA_PURCHASE], minTeamRole: 'owner' },
  {
    operationId: 'purchaseStorageCapacity',
    summary: 'Purchase workspace storage capacity with x402',
    description:
      'Call without PAYMENT-SIGNATURE to receive a standard x402 PAYMENT-REQUIRED challenge. Pay it and retry this same request with PAYMENT-SIGNATURE. A delivered response means the workspace capacity entitlement is active; retry the original createObject request.',
    tags: ['Store'],
    method: 'post',
    path: '/capacity-purchases/{resourceId}',
    middleware: [requireFeature('quota_store')] as const,
    request: {
      params: z.object({ resourceId: z.string().min(1) }),
      headers: z.object({
        'payment-signature': z
          .string()
          .min(1)
          .max(64 * 1024)
          .optional(),
      }),
      ...jsonBody(capacityPurchaseInputSchema),
    },
    responses: {
      200: cloudBody('Capacity delivered'),
      202: cloudBody('Payment accepted; capacity fulfillment is pending'),
      400: errorResponse('Invalid capacity offer'),
      402: cloudBody('x402 payment required'),
      403: errorResponse('License not bound'),
      409: errorResponse('Purchase request conflict'),
      429: errorResponse('Too many pending capacity purchases'),
      502: errorResponse('Cloud error'),
    },
  },
)

const discountRoute = authRoute(
  { scopes: [AuthorizationScope.STORE_CREATE] },
  {
    operationId: 'getDiscountQuote',
    summary: 'Get a discount quote',
    tags: ['Store'],
    method: 'post',
    path: '/discount-quotes',
    middleware: [requireFeature('quota_store')] as const,
    request: jsonBody(discountQuoteInputSchema),
    responses: {
      200: cloudBody('Discount quote'),
      403: errorResponse('License not bound'),
      502: errorResponse('Cloud error'),
    },
  },
)

const billingPortalRoute = authRoute(
  { scopes: [AuthorizationScope.STORE_CREATE], minTeamRole: 'owner' },
  {
    operationId: 'createBillingPortalSession',
    summary: 'Create a billing portal session',
    tags: ['Store'],
    method: 'post',
    path: '/billing-portal-sessions',
    middleware: [requireFeature('quota_store')] as const,
    responses: {
      200: cloudBody('Billing portal session'),
      400: errorResponse('No active organization'),
      403: errorResponse('License not bound'),
      502: errorResponse('Cloud error'),
    },
  },
)

const ordersRoute = authRoute(
  { scopes: [AuthorizationScope.STORE_READ], minTeamRole: 'owner' },
  {
    operationId: 'listOrders',
    summary: 'List orders',
    tags: ['Store'],
    method: 'get',
    path: '/orders',
    middleware: [requireFeature('quota_store')] as const,
    request: { query: cloudStoreOrdersQuerySchema },
    responses: {
      200: cloudBody('Orders'),
      400: errorResponse('No active organization'),
      403: errorResponse('Store not ready'),
      502: errorResponse('Cloud error'),
    },
  },
)

const continuePaymentRoute = authRoute(
  { scopes: [AuthorizationScope.STORE_CREATE], minTeamRole: 'owner' },
  {
    operationId: 'continueOrderPayment',
    summary: 'Continue an order payment',
    tags: ['Store'],
    method: 'post',
    path: '/orders/{orderId}/payments',
    middleware: [requireFeature('quota_store')] as const,
    request: { params: z.object({ orderId: z.string() }) },
    responses: {
      200: cloudBody('Payment continuation'),
      400: errorResponse('No active organization'),
      403: errorResponse('Forbidden'),
      404: errorResponse('Order not found'),
      502: errorResponse('Cloud error'),
    },
  },
)

const cancelOrderRoute = authRoute(
  { scopes: [AuthorizationScope.STORE_UPDATE], minTeamRole: 'owner' },
  {
    operationId: 'cancelOrder',
    summary: 'Cancel an order',
    tags: ['Store'],
    method: 'put',
    path: '/orders/{orderId}/status',
    middleware: [requireFeature('quota_store')] as const,
    request: { params: z.object({ orderId: z.string() }), ...jsonBody(z.object({ status: z.literal('canceled') })) },
    responses: {
      200: cloudBody('Canceled order'),
      400: errorResponse('No active organization'),
      403: errorResponse('Forbidden'),
      404: errorResponse('Order not found'),
      502: errorResponse('Cloud error'),
    },
  },
)

const app = new OpenAPIHono<Env>()

export const cloudStore = app
  .openapi(packagesRoute, async (c) => {
    const result = await listPackages(c.get('deps'), getCloudBaseUrl(c))
    if (!result.ok) throw result.error
    return c.json(result.value, 200)
  })
  .openapi(creditProductsRoute, async (c) => {
    const result = await listCreditProducts(c.get('deps'), getCloudBaseUrl(c))
    if (!result.ok) throw result.error
    return c.json(result.value, 200)
  })
  .openapi(targetsRoute, async (c) => {
    const result = await listTargets(c.get('deps'), c.get('userId')!)
    if (!result.ok) throw result.error
    return c.json(result.value, 200)
  })
  .openapi(creditsRoute, async (c) => {
    const targetOrgId = c.get('orgId')
    if (!targetOrgId) throw badRequest('No active organization')
    const result = await getCreditBalance(c.get('deps'), getCloudBaseUrl(c), targetOrgId)
    if (!result.ok) throw result.error
    return c.json(result.value, 200)
  })
  .openapi(ledgerRoute, async (c) => {
    const targetOrgId = c.get('orgId')
    if (!targetOrgId) throw badRequest('No active organization')
    const result = await getCreditLedger(c.get('deps'), getCloudBaseUrl(c), targetOrgId)
    if (!result.ok) throw result.error
    return c.json(result.value, 200)
  })
  .openapi(redeemRoute, async (c) => {
    const targetOrgId = c.get('orgId')
    if (!targetOrgId) throw badRequest('No active organization')
    const result = await redeemGiftCard(c.get('deps'), getCloudBaseUrl(c), {
      orgId: targetOrgId,
      input: c.req.valid('json'),
    })
    if (!result.ok) throw result.error
    return c.json(result.value, 200)
  })
  .openapi(checkoutRoute, async (c) => {
    const targetOrgId = c.get('orgId')
    if (!targetOrgId) throw badRequest('No active organization')
    const result = await createCheckout(c.get('deps'), getCloudBaseUrl(c), {
      userId: c.get('userId')!,
      orgId: targetOrgId,
      origin: await getInstanceOrigin(c),
      input: c.req.valid('json'),
    })
    if (!result.ok) throw result.error
    return c.json(result.value, 200)
  })
  .openapi(capacityPurchaseRoute, async (c) => {
    const orgId = c.get('orgId')
    if (!orgId) throw badRequest('No active organization')
    const body = c.req.valid('json')
    const result = await purchaseCapacity(c.get('deps'), getCloudBaseUrl(c), {
      userId: c.get('userId')!,
      orgId,
      origin: await getInstanceOrigin(c),
      resourceId: c.req.valid('param').resourceId,
      requestHash: body.requestHash,
      idempotencyKey: body.idempotencyKey,
      paymentSignature: c.req.valid('header')['payment-signature'] ?? null,
    })
    if (!result.ok) throw result.error
    if (result.kind === 'payment_required') {
      c.header('PAYMENT-REQUIRED', result.paymentRequiredHeader)
      return c.json(result.paymentRequired, 402)
    }
    if (result.paymentResponseHeader) c.header('PAYMENT-RESPONSE', result.paymentResponseHeader)
    return c.json(result.attempt, result.kind === 'delivered' ? 200 : 202)
  })
  .openapi(discountRoute, async (c) => {
    const result = await getDiscountQuote(c.get('deps'), getCloudBaseUrl(c), c.req.valid('json'))
    if (!result.ok) throw result.error
    return c.json(result.value, 200)
  })
  .openapi(billingPortalRoute, async (c) => {
    const targetOrgId = c.get('orgId')
    if (!targetOrgId) throw badRequest('No active organization')
    const result = await createBillingPortalSession(c.get('deps'), getCloudBaseUrl(c), {
      orgId: targetOrgId,
      origin: await getInstanceOrigin(c),
    })
    if (!result.ok) throw result.error
    return c.json(result.value, 200)
  })
  .openapi(ordersRoute, async (c) => {
    const ready = await getStoreReadiness(c.get('deps'))
    if (!ready.ready) throw forbidden(ready.error)
    const targetOrgId = c.get('orgId')
    if (!targetOrgId) throw badRequest('No active organization')
    const query = c.req.valid('query')
    const result = await getCloudOrders(c, { limit: query.limit, offset: query.offset, customerId: targetOrgId })
    if ('error' in result) throw badGateway(result.error)
    return c.json(result, 200)
  })
  .openapi(continuePaymentRoute, async (c) => {
    const ready = await getStoreReadiness(c.get('deps'))
    if (!ready.ready) throw forbidden(ready.error)
    const targetOrgId = c.get('orgId')
    if (!targetOrgId) throw badRequest('No active organization')
    const result = await continueOrderPayment(c.get('deps'), getCloudBaseUrl(c), {
      orgId: targetOrgId,
      orderId: c.req.valid('param').orderId,
      origin: await getInstanceOrigin(c),
    })
    if (!result.ok) throw result.error
    return c.json(result.value, 200)
  })
  .openapi(cancelOrderRoute, async (c) => {
    const ready = await getStoreReadiness(c.get('deps'))
    if (!ready.ready) throw forbidden(ready.error)
    const targetOrgId = c.get('orgId')
    if (!targetOrgId) throw badRequest('No active organization')
    const result = await cancelOrder(c.get('deps'), getCloudBaseUrl(c), {
      orgId: targetOrgId,
      orderId: c.req.valid('param').orderId,
      status: c.req.valid('json').status,
    })
    if (!result.ok) throw result.error
    return c.json(result.value, 200)
  })
