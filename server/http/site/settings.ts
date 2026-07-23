import { createRoute, OpenAPIHono } from '@hono/zod-openapi'
import {
  siteCaptchaSettingsSchema,
  siteIdentitySettingsSchema,
  siteQuotaSettingsSchema,
  siteRegistrationSettingsSchema,
  siteSettingsSchema,
  siteWebDavSettingsSchema,
  updateSiteCaptchaSchema,
  updateSiteIdentitySchema,
  updateSiteQuotasSchema,
  updateSiteRegistrationSchema,
  updateSiteWebDavSchema,
} from '@shared/schemas'
import { requireAdmin } from '../../middleware/auth'
import type { Env } from '../../middleware/platform'
import {
  getSiteSettings,
  updateSiteCaptcha,
  updateSiteIdentity,
  updateSiteQuotas,
  updateSiteRegistration,
  updateSiteWebDav,
  verifySiteWebDav,
} from '../../usecases/site/settings'
import { errorResponse, jsonBody, jsonContent } from '../openapi'

const getRoute = createRoute({
  operationId: 'getSiteSettings',
  summary: 'Get editable site settings',
  tags: ['Site Settings'],
  method: 'get',
  path: '/',
  middleware: [requireAdmin] as const,
  responses: { 200: jsonContent(siteSettingsSchema, 'Editable site settings') },
})

const updateIdentityRoute = createRoute({
  operationId: 'updateSiteIdentity',
  summary: 'Update site identity settings',
  tags: ['Site Settings'],
  method: 'put',
  path: '/identity',
  middleware: [requireAdmin] as const,
  request: jsonBody(updateSiteIdentitySchema),
  responses: {
    200: jsonContent(siteIdentitySettingsSchema, 'Updated site identity settings'),
    400: errorResponse('Invalid site identity'),
    402: errorResponse('Feature not available'),
  },
})

const updateRegistrationRoute = createRoute({
  operationId: 'updateSiteRegistration',
  summary: 'Update registration settings',
  tags: ['Site Settings'],
  method: 'put',
  path: '/registration',
  middleware: [requireAdmin] as const,
  request: jsonBody(updateSiteRegistrationSchema),
  responses: {
    200: jsonContent(siteRegistrationSettingsSchema, 'Updated registration settings'),
    402: errorResponse('Feature not available'),
  },
})

const updateCaptchaRoute = createRoute({
  operationId: 'updateSiteCaptcha',
  summary: 'Update captcha settings',
  tags: ['Site Settings'],
  method: 'put',
  path: '/captcha',
  middleware: [requireAdmin] as const,
  request: jsonBody(updateSiteCaptchaSchema),
  responses: {
    200: jsonContent(siteCaptchaSettingsSchema, 'Updated captcha settings'),
    400: errorResponse('Invalid captcha settings'),
  },
})

const updateQuotasRoute = createRoute({
  operationId: 'updateSiteQuotas',
  summary: 'Update default quota settings',
  tags: ['Site Settings'],
  method: 'put',
  path: '/quotas',
  middleware: [requireAdmin] as const,
  request: jsonBody(updateSiteQuotasSchema),
  responses: { 200: jsonContent(siteQuotaSettingsSchema, 'Updated quota settings') },
})

const verifyWebDavRoute = createRoute({
  operationId: 'verifySiteWebDav',
  summary: 'Verify the configured or derived WebDAV domain',
  tags: ['Site Settings'],
  method: 'post',
  path: '/webdav/verification',
  middleware: [requireAdmin] as const,
  responses: { 200: jsonContent(siteWebDavSettingsSchema, 'Current WebDAV verification status') },
})

const updateWebDavRoute = createRoute({
  operationId: 'updateSiteWebDav',
  summary: 'Update WebDAV settings',
  tags: ['Site Settings'],
  method: 'put',
  path: '/webdav',
  middleware: [requireAdmin] as const,
  request: jsonBody(updateSiteWebDavSchema),
  responses: {
    200: jsonContent(siteWebDavSettingsSchema, 'Updated WebDAV settings'),
    400: errorResponse('Invalid WebDAV settings'),
  },
})

export const siteSettings = new OpenAPIHono<Env>()
  .openapi(getRoute, async (c) => c.json(await getSiteSettings(c.get('deps'), c.req.url), 200))
  .openapi(updateIdentityRoute, async (c) => c.json(await updateSiteIdentity(c.get('deps'), c.req.valid('json')), 200))
  .openapi(updateRegistrationRoute, async (c) =>
    c.json(await updateSiteRegistration(c.get('deps'), c.req.valid('json')), 200),
  )
  .openapi(updateCaptchaRoute, async (c) => c.json(await updateSiteCaptcha(c.get('deps'), c.req.valid('json')), 200))
  .openapi(updateQuotasRoute, async (c) => c.json(await updateSiteQuotas(c.get('deps'), c.req.valid('json')), 200))
  .openapi(updateWebDavRoute, async (c) =>
    c.json(await updateSiteWebDav(c.get('deps'), c.req.valid('json'), c.req.url), 200),
  )
  .openapi(verifyWebDavRoute, async (c) => c.json(await verifySiteWebDav(c.get('deps'), c.req.url, fetch), 200))
