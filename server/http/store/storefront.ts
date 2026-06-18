import { createRoute, OpenAPIHono, z } from '@hono/zod-openapi'
import { checkoutInputSchema, discountQuoteInputSchema, redeemGiftCardInputSchema } from '@shared/schemas'
import { requireAuth, requireTeamRole } from '../../middleware/auth'
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
  redeemGiftCard,
} from '../../usecases/store/store'
import { errorResponse, jsonBody, jsonContent } from '../openapi'
import { cloudStoreOrdersQuerySchema, getCloudBaseUrl } from './helpers'
import { getCloudOrders, getInstanceOrigin } from './shared'

// Storefront responses are passed through verbatim from the upstream cloud
// commerce API, whose payloads are owned by that service. They are documented as
// opaque objects rather than mirrored field-for-field here.
const cloudValue = z.unknown().openapi('CloudStoreValue')
const cloudBody = (description: string) => jsonContent(cloudValue, description)

const packagesRoute = createRoute({
  operationId: 'listStorePackages',
  summary: 'List store packages',
  tags: ['Store'],
  method: 'get',
  path: '/packages',
  responses: { 200: cloudBody('Packages'), 403: errorResponse('License not bound'), 502: errorResponse('Cloud error') },
})

const creditProductsRoute = createRoute({
  operationId: 'listCreditProducts',
  summary: 'List credit products',
  tags: ['Store'],
  method: 'get',
  path: '/credits/products',
  responses: {
    200: cloudBody('Credit products'),
    403: errorResponse('License not bound'),
    502: errorResponse('Cloud error'),
  },
})

const targetsRoute = createRoute({
  operationId: 'listStoreTargets',
  summary: 'List store targets',
  tags: ['Store'],
  method: 'get',
  path: '/targets',
  responses: { 200: cloudBody('Targets'), 403: errorResponse('License not bound'), 502: errorResponse('Cloud error') },
})

const creditsRoute = createRoute({
  operationId: 'getCreditBalance',
  summary: 'Get credit balance',
  tags: ['Store'],
  method: 'get',
  path: '/credits',
  middleware: [requireTeamRole('owner')] as const,
  responses: {
    200: cloudBody('Credit balance'),
    400: errorResponse('No active organization'),
    403: errorResponse('License not bound'),
    502: errorResponse('Cloud error'),
  },
})

const ledgerRoute = createRoute({
  operationId: 'getCreditLedger',
  summary: 'Get credit ledger',
  tags: ['Store'],
  method: 'get',
  path: '/credits/ledger-entries',
  middleware: [requireTeamRole('owner')] as const,
  responses: {
    200: cloudBody('Credit ledger'),
    400: errorResponse('No active organization'),
    403: errorResponse('License not bound'),
    502: errorResponse('Cloud error'),
  },
})

const redeemRoute = createRoute({
  operationId: 'redeemGiftCard',
  summary: 'Redeem a gift card',
  tags: ['Store'],
  method: 'post',
  path: '/credits/redemptions',
  middleware: [requireTeamRole('owner')] as const,
  request: jsonBody(redeemGiftCardInputSchema),
  responses: {
    200: cloudBody('Redemption result'),
    400: errorResponse('No active organization'),
    403: errorResponse('License not bound'),
    502: errorResponse('Cloud error'),
  },
})

const checkoutRoute = createRoute({
  operationId: 'createCheckout',
  summary: 'Create a checkout',
  tags: ['Store'],
  method: 'post',
  path: '/checkouts',
  middleware: [requireTeamRole('owner')] as const,
  request: jsonBody(checkoutInputSchema),
  responses: {
    200: cloudBody('Checkout session'),
    400: errorResponse('Bad request'),
    403: errorResponse('License not bound'),
    409: errorResponse('Workspace plan already exists'),
    502: errorResponse('Cloud error'),
  },
})

const discountRoute = createRoute({
  operationId: 'getDiscountQuote',
  summary: 'Get a discount quote',
  tags: ['Store'],
  method: 'post',
  path: '/discount-quotes',
  request: jsonBody(discountQuoteInputSchema),
  responses: {
    200: cloudBody('Discount quote'),
    403: errorResponse('License not bound'),
    502: errorResponse('Cloud error'),
  },
})

const billingPortalRoute = createRoute({
  operationId: 'createBillingPortalSession',
  summary: 'Create a billing portal session',
  tags: ['Store'],
  method: 'post',
  path: '/billing-portal-sessions',
  middleware: [requireTeamRole('owner')] as const,
  responses: {
    200: cloudBody('Billing portal session'),
    400: errorResponse('No active organization'),
    403: errorResponse('License not bound'),
    502: errorResponse('Cloud error'),
  },
})

const ordersRoute = createRoute({
  operationId: 'listOrders',
  summary: 'List orders',
  tags: ['Store'],
  method: 'get',
  path: '/orders',
  middleware: [requireTeamRole('owner')] as const,
  request: { query: cloudStoreOrdersQuerySchema },
  responses: {
    200: cloudBody('Orders'),
    400: errorResponse('No active organization'),
    403: errorResponse('Store not ready'),
    502: errorResponse('Cloud error'),
  },
})

const continuePaymentRoute = createRoute({
  operationId: 'continueOrderPayment',
  summary: 'Continue an order payment',
  tags: ['Store'],
  method: 'post',
  path: '/orders/{orderId}/payments',
  middleware: [requireTeamRole('owner')] as const,
  request: { params: z.object({ orderId: z.string() }) },
  responses: {
    200: cloudBody('Payment continuation'),
    400: errorResponse('No active organization'),
    403: errorResponse('Forbidden'),
    404: errorResponse('Order not found'),
    502: errorResponse('Cloud error'),
  },
})

const cancelOrderRoute = createRoute({
  operationId: 'cancelOrder',
  summary: 'Cancel an order',
  tags: ['Store'],
  method: 'put',
  path: '/orders/{orderId}/status',
  middleware: [requireTeamRole('owner')] as const,
  request: { params: z.object({ orderId: z.string() }), ...jsonBody(z.object({ status: z.literal('canceled') })) },
  responses: {
    200: cloudBody('Canceled order'),
    400: errorResponse('No active organization'),
    403: errorResponse('Forbidden'),
    404: errorResponse('Order not found'),
    502: errorResponse('Cloud error'),
  },
})

const app = new OpenAPIHono<Env>()
app.use(requireAuth)
app.use(requireFeature('quota_store'))

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
