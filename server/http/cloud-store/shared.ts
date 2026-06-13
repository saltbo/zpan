import type { z } from 'zod'
import { originFromRequestUrl } from '../../domain/site-public-origin'
import { getSitePublicOrigin } from '../../usecases/site-public-origin'
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

export async function getInstanceOrigin(c: RouteContext): Promise<string> {
  const configuredOrigin = await getSitePublicOrigin(c.get('deps'))
  if (configuredOrigin) return configuredOrigin
  return originFromRequestUrl(c.req.url) ?? new URL(c.req.url).origin
}
