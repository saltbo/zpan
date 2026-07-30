import { OpenAPIHono } from '@hono/zod-openapi'
import { AuthorizationScope } from '@shared/authorization'
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
import { authRoute, errorResponse, jsonBody, jsonContent } from '../openapi'

const getRoute = authRoute(
  { scopes: [AuthorizationScope.SITE_SETTINGS_READ], siteRole: 'admin' },
  {
    operationId: 'getSiteSettings',
    summary: 'Get editable site settings',
    tags: ['Site Settings'],
    method: 'get',
    path: '/',
    responses: { 200: jsonContent(siteSettingsSchema, 'Editable site settings') },
  },
)

const updateIdentityRoute = authRoute(
  { scopes: [AuthorizationScope.SITE_SETTINGS_UPDATE], siteRole: 'admin' },
  {
    operationId: 'updateSiteIdentity',
    summary: 'Update site identity settings',
    tags: ['Site Settings'],
    method: 'put',
    path: '/identity',
    request: jsonBody(updateSiteIdentitySchema),
    responses: {
      200: jsonContent(siteIdentitySettingsSchema, 'Updated site identity settings'),
      400: errorResponse('Invalid site identity'),
      402: errorResponse('Feature not available'),
    },
  },
)

const updateRegistrationRoute = authRoute(
  { scopes: [AuthorizationScope.SITE_SETTINGS_UPDATE], siteRole: 'admin' },
  {
    operationId: 'updateSiteRegistration',
    summary: 'Update registration settings',
    tags: ['Site Settings'],
    method: 'put',
    path: '/registration',
    request: jsonBody(updateSiteRegistrationSchema),
    responses: {
      200: jsonContent(siteRegistrationSettingsSchema, 'Updated registration settings'),
      402: errorResponse('Feature not available'),
    },
  },
)

const updateCaptchaRoute = authRoute(
  { scopes: [AuthorizationScope.SITE_SETTINGS_UPDATE], siteRole: 'admin' },
  {
    operationId: 'updateSiteCaptcha',
    summary: 'Update captcha settings',
    tags: ['Site Settings'],
    method: 'put',
    path: '/captcha',
    request: jsonBody(updateSiteCaptchaSchema),
    responses: {
      200: jsonContent(siteCaptchaSettingsSchema, 'Updated captcha settings'),
      400: errorResponse('Invalid captcha settings'),
    },
  },
)

const updateQuotasRoute = authRoute(
  { scopes: [AuthorizationScope.SITE_SETTINGS_UPDATE], siteRole: 'admin' },
  {
    operationId: 'updateSiteQuotas',
    summary: 'Update default quota settings',
    tags: ['Site Settings'],
    method: 'put',
    path: '/quotas',
    request: jsonBody(updateSiteQuotasSchema),
    responses: { 200: jsonContent(siteQuotaSettingsSchema, 'Updated quota settings') },
  },
)

const verifyWebDavRoute = authRoute(
  { scopes: [AuthorizationScope.SITE_SETTINGS_UPDATE], siteRole: 'admin' },
  {
    operationId: 'verifySiteWebDav',
    summary: 'Verify the configured or derived WebDAV domain',
    tags: ['Site Settings'],
    method: 'post',
    path: '/webdav/verifications',
    responses: { 200: jsonContent(siteWebDavSettingsSchema, 'Current WebDAV verification status') },
  },
)

const updateWebDavRoute = authRoute(
  { scopes: [AuthorizationScope.SITE_SETTINGS_UPDATE], siteRole: 'admin' },
  {
    operationId: 'updateSiteWebDav',
    summary: 'Update WebDAV settings',
    tags: ['Site Settings'],
    method: 'put',
    path: '/webdav',
    request: jsonBody(updateSiteWebDavSchema),
    responses: {
      200: jsonContent(siteWebDavSettingsSchema, 'Updated WebDAV settings'),
      400: errorResponse('Invalid WebDAV settings'),
    },
  },
)

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
