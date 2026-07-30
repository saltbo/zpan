import { OpenAPIHono, z } from '@hono/zod-openapi'
import { AuthorizationScope } from '@shared/authorization'
import { imageDomainProviderResponseSchema, updateImageDomainSettingsSchema } from '@shared/schemas'
import type { Env } from '../../middleware/platform'
import { requireFeature } from '../../middleware/require-feature'
import {
  getImageDomainProvider,
  saveImageDomainProvider,
  testImageDomainProvider,
} from '../../usecases/site/image-domain-provider'
import { authRoute, errorResponse, jsonContent } from '../openapi'

const successSchema = z.object({ success: z.literal(true) })

const getRoute = authRoute(
  { scopes: [AuthorizationScope.IMAGE_DOMAIN_PROVIDER_READ], siteRole: 'admin' },
  {
    operationId: 'getImageDomainProvider',
    summary: 'Get image custom-domain provider',
    tags: ['Image Domain Provider'],
    method: 'get',
    path: '/',
    responses: { 200: jsonContent(imageDomainProviderResponseSchema, 'Image custom-domain provider') },
  },
)

const saveRoute = authRoute(
  { scopes: [AuthorizationScope.IMAGE_DOMAIN_PROVIDER_UPDATE], siteRole: 'admin' },
  {
    operationId: 'saveImageDomainProvider',
    summary: 'Save image custom-domain provider',
    tags: ['Image Domain Provider'],
    method: 'put',
    path: '/',
    middleware: [requireFeature('image_custom_domains')] as const,
    request: {
      body: { content: { 'application/json': { schema: updateImageDomainSettingsSchema } }, required: true },
    },
    responses: {
      200: jsonContent(successSchema, 'Saved'),
      400: errorResponse('Invalid provider configuration'),
    },
  },
)

const testRoute = authRoute(
  { scopes: [AuthorizationScope.IMAGE_DOMAIN_PROVIDER_TEST], siteRole: 'admin' },
  {
    operationId: 'testImageDomainProvider',
    summary: 'Test image custom-domain provider and reconcile domains',
    tags: ['Image Domain Provider'],
    method: 'post',
    path: '/tests',
    middleware: [requireFeature('image_custom_domains')] as const,
    responses: {
      200: jsonContent(successSchema, 'Provider ready'),
      400: errorResponse('Provider test failed'),
    },
  },
)

const app = new OpenAPIHono<Env>()

const imageDomainProvider = app
  .openapi(getRoute, async (c) => c.json(await getImageDomainProvider(c.get('deps')), 200))
  .openapi(saveRoute, async (c) => {
    await saveImageDomainProvider(c.get('deps'), c.req.valid('json'))
    return c.json({ success: true } as const, 200)
  })
  .openapi(testRoute, async (c) => {
    await testImageDomainProvider(c.get('deps'))
    return c.json({ success: true } as const, 200)
  })

export default imageDomainProvider
