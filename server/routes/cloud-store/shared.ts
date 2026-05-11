import type { z } from 'zod'
import {
  cloudOrdersResponseSchema,
  getBoundCloudClient,
  type RouteContext,
  unwrapCloudResponse,
} from '../cloud-store-helpers'

const CLOUD_ORDER_PAGE_SIZE = 100

type CloudOrders = z.infer<typeof cloudOrdersResponseSchema>

export async function getCloudOrders(
  c: RouteContext,
  options: { limit?: number; offset?: number; customerId?: string } = {},
): Promise<CloudOrders | { error: string }> {
  try {
    const { client, storeId } = await getBoundCloudClient(c)
    return await unwrapCloudResponse(
      await client.stores[':storeId'].orders.$get({
        param: { storeId },
        query: {
          limit: String(options.limit ?? CLOUD_ORDER_PAGE_SIZE),
          ...(options.offset !== undefined ? { offset: String(options.offset) } : {}),
          ...(options.customerId ? { customerId: options.customerId } : {}),
        },
      }),
      cloudOrdersResponseSchema,
    )
  } catch (error) {
    return { error: (error as Error).message }
  }
}

export function getInstanceOrigin(c: RouteContext): string {
  const configuredOrigin = publicOriginFromEnv(
    c.get('platform').getEnv('ZPAN_PUBLIC_ORIGIN') ?? c.get('platform').getEnv('BETTER_AUTH_URL'),
  )
  if (configuredOrigin) return configuredOrigin
  const requestUrl = new URL(c.req.url)
  if (requestUrl.protocol === 'https:' || isLocalHost(requestUrl.hostname)) return requestUrl.origin
  return `https://${requestUrl.host}`
}

function publicOriginFromEnv(value: string | undefined): string | null {
  if (!value) return null
  try {
    const url = new URL(value)
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return null
    return url.origin
  } catch {
    return null
  }
}

function isLocalHost(hostname: string) {
  return hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '[::1]'
}
