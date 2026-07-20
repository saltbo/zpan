import { z } from 'zod'

export const signupModeSchema = z.enum(['open', 'invite_only', 'closed']).openapi('SignupMode')
export const captchaProviderSchema = z
  .enum(['google-recaptcha', 'cloudflare-turnstile', 'hcaptcha', 'captchafox'])
  .openapi('CaptchaProvider')

export const brandingThemePresetSchema = z.enum(['default', 'ocean', 'forest', 'rose']).openapi('BrandingThemePreset')

export const brandingThemeValuesSchema = z
  .object({
    primaryColor: z.string(),
    primaryForeground: z.string(),
    canvasColor: z.string(),
    sidebarAccentColor: z.string(),
    ringColor: z.string(),
  })
  .openapi('BrandingThemeValues')

export const siteBrandingSchema = z
  .object({
    logoUrl: z.string().nullable(),
    faviconUrl: z.string().nullable(),
    wordmark: z.string().nullable(),
    hidePoweredBy: z.boolean(),
    theme: z.object({
      mode: z.enum(['preset', 'custom']),
      preset: brandingThemePresetSchema,
      custom: brandingThemeValuesSchema.nullable(),
      configured: z.boolean(),
    }),
  })
  .openapi('SiteBranding')

export const publicCaptchaSchema = z
  .discriminatedUnion('enabled', [
    z.object({ enabled: z.literal(false) }),
    z.object({ enabled: z.literal(true), provider: captchaProviderSchema, siteKey: z.string() }),
  ])
  .openapi('PublicCaptcha')

export const publicAuthProviderSchema = z
  .object({
    id: z.string(),
    type: z.enum(['builtin', 'oidc']),
    name: z.string(),
    icon: z.string(),
  })
  .openapi('PublicAuthProvider')

export const siteConfigSchema = z
  .object({
    site: z.object({ name: z.string(), description: z.string(), publicUrl: z.string() }),
    branding: siteBrandingSchema,
    auth: z.object({
      signupMode: signupModeSchema,
      captcha: publicCaptchaSchema,
      providers: z.array(publicAuthProviderSchema),
    }),
    services: z.object({ webdav: z.object({ url: z.string() }) }),
  })
  .openapi('SiteConfig')

const publicOriginSchema = z
  .url()
  .refine((value) => {
    const url = new URL(value)
    return (
      (url.protocol === 'http:' || url.protocol === 'https:') &&
      url.username === '' &&
      url.password === '' &&
      url.pathname === '/' &&
      url.search === '' &&
      url.hash === ''
    )
  }, 'Public URL must be an HTTP or HTTPS origin without a path, query, or fragment')
  .openapi('PublicOrigin')

export const siteIdentitySettingsSchema = z
  .object({
    name: z.string().min(1),
    description: z.string(),
    publicUrl: publicOriginSchema,
  })
  .openapi('SiteIdentitySettings')

export const siteRegistrationSettingsSchema = z
  .object({
    configuredMode: signupModeSchema,
    effectiveMode: signupModeSchema,
  })
  .openapi('SiteRegistrationSettings')

export const siteCaptchaSettingsSchema = z
  .object({
    enabled: z.boolean(),
    provider: captchaProviderSchema,
    siteKey: z.string(),
    secretConfigured: z.boolean(),
    minScore: z.number().min(0).max(1).nullable(),
  })
  .openapi('SiteCaptchaSettings')

export const siteQuotaSettingsSchema = z
  .object({
    defaultOrgBytes: z.number().int().positive(),
    defaultTeamBytes: z.number().int().positive(),
    defaultMonthlyTrafficBytes: z.number().int().nonnegative(),
  })
  .openapi('SiteQuotaSettings')

export const webDavVerificationStatusSchema = z
  .enum(['unverified', 'ready', 'failed'])
  .openapi('WebDavVerificationStatus')

export const siteWebDavSettingsSchema = z
  .object({
    pathUrl: z.url(),
    candidateUrl: z.url().nullable(),
    status: webDavVerificationStatusSchema,
    lastVerifiedAt: z.iso.datetime().nullable(),
    error: z.string().nullable(),
  })
  .openapi('SiteWebDavSettings')

export const siteSettingsSchema = z
  .object({
    identity: siteIdentitySettingsSchema,
    registration: siteRegistrationSettingsSchema,
    captcha: siteCaptchaSettingsSchema,
    quotas: siteQuotaSettingsSchema,
    webdav: siteWebDavSettingsSchema,
  })
  .openapi('SiteSettings')

export const updateSiteIdentitySchema = siteIdentitySettingsSchema
export const updateSiteRegistrationSchema = z.object({ mode: signupModeSchema }).openapi('UpdateSiteRegistration')
export const updateSiteCaptchaSchema = z
  .object({
    enabled: z.boolean(),
    provider: captchaProviderSchema,
    siteKey: z.string(),
    secretKey: z.string().nullable().optional(),
    minScore: z.number().min(0).max(1).nullable(),
  })
  .openapi('UpdateSiteCaptcha')
export const updateSiteQuotasSchema = siteQuotaSettingsSchema

export type SiteConfig = z.infer<typeof siteConfigSchema>
export type SiteBranding = z.infer<typeof siteBrandingSchema>
export type SiteSettings = z.infer<typeof siteSettingsSchema>
export type SiteIdentitySettings = z.infer<typeof siteIdentitySettingsSchema>
export type SiteRegistrationSettings = z.infer<typeof siteRegistrationSettingsSchema>
export type SiteCaptchaSettings = z.infer<typeof siteCaptchaSettingsSchema>
export type SiteQuotaSettings = z.infer<typeof siteQuotaSettingsSchema>
export type SiteWebDavSettings = z.infer<typeof siteWebDavSettingsSchema>
export type UpdateSiteIdentityInput = z.infer<typeof updateSiteIdentitySchema>
export type UpdateSiteRegistrationInput = z.infer<typeof updateSiteRegistrationSchema>
export type UpdateSiteCaptchaInput = z.infer<typeof updateSiteCaptchaSchema>
export type UpdateSiteQuotasInput = z.infer<typeof updateSiteQuotasSchema>
