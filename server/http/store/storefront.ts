import { zValidator } from '@hono/zod-validator'
import { checkoutInputSchema, discountQuoteInputSchema, redeemGiftCardInputSchema } from '@shared/schemas'
import { Hono } from 'hono'
import { z } from 'zod'
import { requireAuth, requireTeamRole } from '../../middleware/auth'
import type { Env } from '../../middleware/platform'
import { requireFeature } from '../../middleware/require-feature'
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
import { cloudStoreOrdersQuerySchema, getCloudBaseUrl } from './helpers'
import { getCloudOrders, getInstanceOrigin } from './shared'

export const cloudStore = new Hono<Env>()
  .use(requireAuth)
  .use(requireFeature('quota_store'))
  .get('/packages', async (c) => {
    const result = await listPackages(c.get('deps'), getCloudBaseUrl(c))
    if (!result.ok) return c.json({ error: result.error }, result.reason === 'binding_missing' ? 403 : 502)
    return c.json(result.value)
  })
  .get('/credits/products', async (c) => {
    const result = await listCreditProducts(c.get('deps'), getCloudBaseUrl(c))
    if (!result.ok) return c.json({ error: result.error }, result.reason === 'binding_missing' ? 403 : 502)
    return c.json(result.value)
  })
  .get('/targets', async (c) => {
    const result = await listTargets(c.get('deps'), c.get('userId')!)
    if (!result.ok) return c.json({ error: result.error }, result.reason === 'binding_missing' ? 403 : 502)
    return c.json(result.value)
  })
  .get('/credits', requireTeamRole('owner'), async (c) => {
    const targetOrgId = c.get('orgId')
    if (!targetOrgId) return c.json({ error: 'No active organization' }, 400)
    const result = await getCreditBalance(c.get('deps'), getCloudBaseUrl(c), targetOrgId)
    if (!result.ok) return c.json({ error: result.error }, result.reason === 'binding_missing' ? 403 : 502)
    return c.json(result.value)
  })
  .get('/credits/ledger-entries', requireTeamRole('owner'), async (c) => {
    const targetOrgId = c.get('orgId')
    if (!targetOrgId) return c.json({ error: 'No active organization' }, 400)
    const result = await getCreditLedger(c.get('deps'), getCloudBaseUrl(c), targetOrgId)
    if (!result.ok) return c.json({ error: result.error }, result.reason === 'binding_missing' ? 403 : 502)
    return c.json(result.value)
  })
  .post('/credits/redemptions', requireTeamRole('owner'), zValidator('json', redeemGiftCardInputSchema), async (c) => {
    const targetOrgId = c.get('orgId')
    if (!targetOrgId) return c.json({ error: 'No active organization' }, 400)
    const result = await redeemGiftCard(c.get('deps'), getCloudBaseUrl(c), {
      orgId: targetOrgId,
      input: c.req.valid('json'),
    })
    if (!result.ok) return c.json({ error: result.error }, result.reason === 'binding_missing' ? 403 : 502)
    return c.json(result.value)
  })
  .post('/checkouts', requireTeamRole('owner'), zValidator('json', checkoutInputSchema), async (c) => {
    const targetOrgId = c.get('orgId')
    if (!targetOrgId) return c.json({ error: 'No active organization' }, 400)
    const result = await createCheckout(c.get('deps'), getCloudBaseUrl(c), {
      userId: c.get('userId')!,
      orgId: targetOrgId,
      origin: await getInstanceOrigin(c),
      input: c.req.valid('json'),
    })
    if (result.ok) return c.json(result.value)
    if (result.reason === 'binding_missing') return c.json({ error: result.error }, 403)
    if (result.reason === 'price_missing') return c.json({ error: 'package_price_missing' }, 400)
    if (result.reason === 'workspace_plan_exists') return c.json({ error: 'workspace_plan_exists' }, 409)
    return c.json({ error: result.error }, 502)
  })
  .post('/discount-quotes', zValidator('json', discountQuoteInputSchema), async (c) => {
    const result = await getDiscountQuote(c.get('deps'), getCloudBaseUrl(c), c.req.valid('json'))
    if (!result.ok) return c.json({ error: result.error }, result.reason === 'binding_missing' ? 403 : 502)
    return c.json(result.value)
  })
  .post('/billing-portal-sessions', requireTeamRole('owner'), async (c) => {
    const targetOrgId = c.get('orgId')
    if (!targetOrgId) return c.json({ error: 'No active organization' }, 400)
    const result = await createBillingPortalSession(c.get('deps'), getCloudBaseUrl(c), {
      orgId: targetOrgId,
      origin: await getInstanceOrigin(c),
    })
    if (!result.ok) return c.json({ error: result.error }, result.reason === 'binding_missing' ? 403 : 502)
    return c.json(result.value)
  })
  .get('/orders', requireTeamRole('owner'), zValidator('query', cloudStoreOrdersQuerySchema), async (c) => {
    const ready = await getStoreReadiness(c.get('deps'))
    if (!ready.ready) return c.json({ error: ready.error }, 403)
    const targetOrgId = c.get('orgId')
    if (!targetOrgId) return c.json({ error: 'No active organization' }, 400)
    const query = c.req.valid('query')
    const result = await getCloudOrders(c, { limit: query.limit, offset: query.offset, customerId: targetOrgId })
    if ('error' in result) return c.json(result, 502)
    return c.json(result)
  })
  .post('/orders/:orderId/payments', requireTeamRole('owner'), async (c) => {
    const ready = await getStoreReadiness(c.get('deps'))
    if (!ready.ready) return c.json({ error: ready.error }, 403)
    const targetOrgId = c.get('orgId')
    if (!targetOrgId) return c.json({ error: 'No active organization' }, 400)
    const result = await continueOrderPayment(c.get('deps'), getCloudBaseUrl(c), {
      orgId: targetOrgId,
      orderId: c.req.param('orderId'),
      origin: await getInstanceOrigin(c),
    })
    if (result.ok) return c.json(result.value)
    if (result.reason === 'not_found') return c.json({ error: 'not_found' }, 404)
    if (result.reason === 'forbidden') return c.json({ error: 'Forbidden' }, 403)
    return c.json({ error: result.error }, 502)
  })
  .patch(
    '/orders/:orderId',
    requireTeamRole('owner'),
    zValidator('json', z.object({ status: z.literal('canceled') })),
    async (c) => {
      const ready = await getStoreReadiness(c.get('deps'))
      if (!ready.ready) return c.json({ error: ready.error }, 403)
      const targetOrgId = c.get('orgId')
      if (!targetOrgId) return c.json({ error: 'No active organization' }, 400)
      const result = await cancelOrder(c.get('deps'), getCloudBaseUrl(c), {
        orgId: targetOrgId,
        orderId: c.req.param('orderId'),
        status: c.req.valid('json').status,
      })
      if (result.ok) return c.json(result.value)
      if (result.reason === 'not_found') return c.json({ error: 'not_found' }, 404)
      if (result.reason === 'forbidden') return c.json({ error: 'Forbidden' }, 403)
      return c.json({ error: result.error }, 502)
    },
  )
