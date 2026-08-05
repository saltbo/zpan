import { createServer } from 'node:http'
import { sign } from 'paseto-ts/v4'

const port = Number(process.env.E2E_CLOUD_FAKE_PORT)
if (!Number.isInteger(port) || port < 1) throw new Error('E2E_CLOUD_FAKE_PORT must be a positive integer')

const origin = `http://127.0.0.1:${port}`
const refreshToken = 'e2e-refresh-token'
const secretKey =
  'k4.secret.HeTVB0fq09qcb21-O9ycT737wPNlxx0I2x7XVJTNuYcfaBgoY23GBZsy7CA90O4egz-w4vMUL6SF7benPYhl8w'
const pairings = new Map()
const balances = new Map()
const orders = []
const product = {
  id: 'e2e-plan',
  storeId: 'e2e-store',
  type: 'store_item',
  name: 'E2E Storage Plan',
  description: 'Local protocol fake plan',
  metadata: { deliverable: { type: 'zpan.plan', storageBytes: 1024 * 1024, includedCredits: 200 } },
  prices: [
    {
      id: 'e2e-price',
      currency: 'usd',
      amount: 100,
      recurring: { interval: 'month', intervalCount: 1 },
    },
  ],
  active: true,
  sortOrder: 1,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
}

createServer(async (request, response) => {
  try {
    await route(request, response)
  } catch (error) {
    console.error(error)
    json(response, 500, { error: { code: 'fake_internal_error' } })
  }
}).listen(port, '127.0.0.1', () => console.log(`zpan-cloud fake listening on ${origin}`))

async function route(request, response) {
  const url = new URL(request.url, origin)
  const method = request.method

  if (method === 'GET' && url.pathname === '/health') return json(response, 200, { status: 'ok' })

  if (method === 'POST' && url.pathname === '/api/pairings') {
    const body = await readJson(request)
    if (!isInstance(body.instance)) return invalidRequest(response, 'invalid_instance')
    const code = `pair-${pairings.size + 1}`
    pairings.set(code, { instance: body.instance, approved: false })
    return json(response, 201, {
      data: { code, pairingUrl: `${origin}/pairings/${code}`, expiresAt: '2099-01-01T00:00:00.000Z' },
    })
  }

  const approvalMatch = url.pathname.match(/^\/_test\/pairings\/([^/]+)\/approve$/)
  if (approvalMatch && method === 'PATCH') {
    const body = await readJson(request)
    if (body.action !== 'approve') return invalidRequest(response, 'invalid_pairing_action')
    const pairing = requiredPairing(approvalMatch[1])
    pairing.approved = true
    return json(response, 200, { data: { status: 'approved' } })
  }

  const pairingMatch = url.pathname.match(/^\/api\/pairings\/([^/]+)$/)
  if (pairingMatch && method === 'PATCH') {
    return json(response, 405, { error: { code: 'method_not_allowed' } })
  }
  if (pairingMatch && method === 'GET') {
    const pairing = requiredPairing(pairingMatch[1])
    if (!pairing.approved) return json(response, 200, { data: { status: 'pending' } })
    return json(response, 200, { data: approvedPairing(pairing.instance) })
  }

  if (/^\/api\/licenses\/[^/]+$/.test(url.pathname) && method === 'PATCH') {
    if (!authorized(request, response)) return
    const body = await readJson(request)
    if (body.status !== 'confirmed') return invalidRequest(response, 'invalid_license_status')
    return json(response, 200, { data: { status: 'confirmed' } })
  }
  if (/^\/api\/licenses\/[^/]+$/.test(url.pathname) && method === 'DELETE') {
    if (!authorized(request, response)) return
    return json(response, 204, null)
  }

  if (method === 'GET' && url.pathname === '/api/stores/e2e-store/products') {
    if (!authorized(request, response)) return
    return json(response, 200, { data: { items: [product], total: 1, limit: 100, offset: 0 } })
  }
  if (method === 'GET' && url.pathname === `/api/stores/e2e-store/products/${product.id}`) {
    if (!authorized(request, response)) return
    return json(response, 200, { data: product })
  }

  const balanceMatch = url.pathname.match(/^\/api\/stores\/e2e-store\/credit-accounts\/([^/]+)\/balance$/)
  if (balanceMatch && method === 'GET') {
    if (!authorized(request, response)) return
    return json(response, 200, { data: { balance: balances.get(balanceMatch[1]) ?? 0 } })
  }
  const redemptionMatch = url.pathname.match(
    /^\/api\/stores\/e2e-store\/credit-accounts\/([^/]+)\/redemptions$/,
  )
  if (redemptionMatch && method === 'POST') {
    if (!authorized(request, response)) return
    const body = await readJson(request)
    if (!isExactStringArray(body.codes, ['E2E-GIFT-200'])) {
      return json(response, 422, { error: { code: 'invalid_gift_card' } })
    }
    const balance = (balances.get(redemptionMatch[1]) ?? 0) + 200
    balances.set(redemptionMatch[1], balance)
    return json(response, 200, {
      data: { redeemedCredits: 200, entries: [], failures: [] },
    })
  }
  if (method === 'POST' && url.pathname === '/api/stores/e2e-store/orders') {
    if (!authorized(request, response)) return
    const body = await readJson(request)
    if (!isOrderRequest(body)) return invalidRequest(response, 'invalid_order')
    const order = cloudOrder(body.target)
    orders.unshift(order)
    return json(response, 201, { data: order })
  }
  if (method === 'POST' && url.pathname === '/api/stores/e2e-store/orders/e2e-order/payments') {
    if (!authorized(request, response)) return
    const body = await readJson(request)
    if (!isPaymentRequest(body)) return invalidRequest(response, 'invalid_payment')
    return json(response, 201, {
      data: { status: 'pending', paymentId: 'e2e-payment', orderId: 'e2e-order', url: `${origin}/checkout` },
    })
  }
  if (method === 'GET' && url.pathname === '/api/stores/e2e-store/orders') {
    if (!authorized(request, response)) return
    const customerId = url.searchParams.get('customerId')
    if (!customerId) return invalidRequest(response, 'customer_id_required')
    const items = customerId
      ? orders.filter((order) => order.target?.customerId === customerId || order.target?.orgId === customerId)
      : orders
    return json(response, 200, { data: { items, total: items.length, limit: 100, offset: 0 } })
  }

  return json(response, 404, { error: { code: 'not_found' } })
}

function approvedPairing(instance) {
  const now = Math.floor(Date.now() / 1000)
  const binding = {
    id: 'e2e-license',
    instanceId: instance.id,
    storeId: 'e2e-store',
    authorizedHosts: [new URL(instance.url).host],
  }
  const certificate = sign(secretKey, {
    type: 'zpan.license',
    issuer: origin,
    subject: binding.id,
    licenseId: binding.id,
    accountId: 'e2e-account',
    instanceId: instance.id,
    edition: 'business',
    authorizedHosts: binding.authorizedHosts,
    licenseValidUntil: now + 86_400,
    issuedAt: now,
    notBefore: now,
    expiresAt: now + 3_600,
  })
  return {
    status: 'approved',
    refreshToken,
    certificate,
    binding,
    account: { id: 'e2e-account', email: 'cloud-fake@e2e.local' },
  }
}

function cloudOrder(target) {
  return {
    id: 'e2e-order',
    storeId: 'e2e-store',
    buyerAccountId: 'e2e-account',
    target,
    status: 'pending',
    paymentStatus: 'pending',
    fulfillmentStatus: 'pending',
    subtotalAmount: 100,
    discountAmount: 0,
    totalAmount: 100,
    currency: 'usd',
    items: [],
    payments: [],
    createdAt: '2026-01-01T00:00:00.000Z',
    paidAt: null,
    fulfilledAt: null,
    canceledAt: null,
  }
}

function requiredPairing(code) {
  const pairing = pairings.get(code)
  if (!pairing) throw new Error(`Unknown pairing ${code}`)
  return pairing
}

function authorized(request, response) {
  if (request.headers.authorization === `Bearer ${refreshToken}`) return true
  json(response, 401, { error: { code: 'unauthorized' } })
  return false
}

function invalidRequest(response, code) {
  return json(response, 422, { error: { code } })
}

function isInstance(instance) {
  if (!instance || typeof instance !== 'object') return false
  if (typeof instance.id !== 'string' || !instance.id) return false
  if (typeof instance.url !== 'string') return false
  try {
    return new URL(instance.url).origin === instance.url
  } catch {
    return false
  }
}

function isExactStringArray(value, expected) {
  return Array.isArray(value) && value.length === expected.length && value.every((item, i) => item === expected[i])
}

function isOrderRequest(body) {
  const item = body.items?.[0]
  const target = body.target
  return (
    Array.isArray(body.items) &&
    body.items.length === 1 &&
    item?.productId === product.id &&
    item?.priceId === product.prices[0].id &&
    item?.quantity === 1 &&
    body.currency === 'usd' &&
    isUrl(body.deliveryCallbackUrl, '/api/store/webhook') &&
    typeof target?.orgId === 'string' &&
    target.orgId.length > 0 &&
    target.customerId === target.orgId &&
    typeof target.customerLabel === 'string' &&
    target.customerLabel.length > 0
  )
}

function isPaymentRequest(body) {
  return isUrl(body.successUrl, '/storage') && isUrl(body.cancelUrl, '/storage')
}

function isUrl(value, pathname) {
  if (typeof value !== 'string') return false
  try {
    return new URL(value).pathname === pathname
  } catch {
    return false
  }
}

async function readJson(request) {
  const chunks = []
  for await (const chunk of request) chunks.push(chunk)
  return JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}')
}

function json(response, status, body) {
  response.statusCode = status
  if (body === null) return response.end()
  response.setHeader('content-type', 'application/json')
  response.end(JSON.stringify(body))
}
