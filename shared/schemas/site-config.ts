import { z } from 'zod'
import { opaqueIdSchema } from './identifiers'

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
    services: z.object({ webdav: z.object({ enabled: z.boolean(), url: z.string() }) }),
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
  .enum(['disabled', 'unverified', 'ready', 'failed'])
  .openapi('WebDavVerificationStatus')

export const siteWebDavSettingsSchema = z
  .object({
    enabled: z.boolean(),
    domain: z.string(),
    pathUrl: z.url(),
    candidateUrl: z.url().nullable(),
    status: webDavVerificationStatusSchema,
    lastVerifiedAt: z.iso.datetime().nullable(),
    error: z.string().nullable(),
  })
  .openapi('SiteWebDavSettings')

const emailSettingsBaseSchema = z.object({
  enabled: z.boolean(),
  requireEmailVerification: z.boolean(),
  from: z.string().email(),
})

export const smtpEmailSettingsSchema = emailSettingsBaseSchema
  .extend({
    provider: z.literal('smtp'),
    smtp: z.object({
      host: z.string().min(1),
      port: z.number().int().min(1).max(65535),
      user: z.string(),
      pass: z.string(),
      secure: z.boolean(),
    }),
  })
  .openapi('SmtpEmailSettings')

export const httpEmailSettingsSchema = emailSettingsBaseSchema
  .extend({
    provider: z.literal('http'),
    http: z.object({ url: z.url(), apiKey: z.string() }),
  })
  .openapi('HttpEmailSettings')

export const cloudflareEmailSettingsSchema = emailSettingsBaseSchema
  .extend({ provider: z.literal('cloudflare') })
  .openapi('CloudflareEmailSettings')

export const emptyEmailSettingsSchema = z
  .object({
    enabled: z.boolean(),
    requireEmailVerification: z.boolean(),
    provider: z.null(),
  })
  .openapi('EmptyEmailSettings')

export const emailSettingsSchema = z
  .union([smtpEmailSettingsSchema, httpEmailSettingsSchema, cloudflareEmailSettingsSchema, emptyEmailSettingsSchema])
  .openapi('EmailSettings')

export const updateEmailSettingsSchema = z
  .discriminatedUnion('provider', [smtpEmailSettingsSchema, httpEmailSettingsSchema, cloudflareEmailSettingsSchema])
  .openapi('UpdateEmailSettings')

export const createTestEmailSchema = z.object({ to: z.string().email() }).openapi('CreateTestEmail')

export const imageDomainDnsRecordSchema = z
  .object({
    type: z.enum(['CNAME', 'A', 'AAAA']),
    value: z.string().trim().min(1),
  })
  .superRefine((record, context) => {
    const hostname = record.value.replace(/\.$/, '')
    if (
      record.type === 'CNAME' &&
      !/^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/i.test(hostname)
    ) {
      context.addIssue({ code: 'custom', message: 'CNAME value must be a hostname', path: ['value'] })
    }
    if (
      record.type === 'A' &&
      !(/^(?:\d{1,3}\.){3}\d{1,3}$/.test(record.value) && record.value.split('.').every((part) => Number(part) <= 255))
    ) {
      context.addIssue({ code: 'custom', message: 'A value must be an IPv4 address', path: ['value'] })
    }
    if (record.type === 'AAAA') {
      try {
        new URL(`http://[${record.value}]/`)
      } catch {
        context.addIssue({ code: 'custom', message: 'AAAA value must be an IPv6 address', path: ['value'] })
      }
    }
  })
  .openapi('ImageDomainDnsRecord')

const imageDomainSettingsBaseSchema = z.object({
  enabled: z.boolean(),
})

const imageDomainHostnameSchema = z
  .string()
  .trim()
  .min(1)
  .max(253)
  .regex(/^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/i, 'Expected a hostname')

const cloudflareImageDomainCommonShape = {
  apiToken: z.string().min(1),
  zoneId: z
    .string()
    .trim()
    .regex(/^[a-f0-9]{32}$/i, 'Zone ID must be 32 hexadecimal characters'),
  cnameTarget: imageDomainHostnameSchema,
}

export const cloudflareSaasImageDomainSettingsSchema = imageDomainSettingsBaseSchema
  .extend({
    provider: z.literal('cloudflare_saas'),
    cloudflare: z.discriminatedUnion('routingMode', [
      z.object({
        ...cloudflareImageDomainCommonShape,
        routingMode: z.literal('worker'),
        workerName: z.string().trim().min(1).max(64),
      }),
      z.object({
        ...cloudflareImageDomainCommonShape,
        routingMode: z.literal('origin'),
        originHostname: imageDomainHostnameSchema,
      }),
    ]),
  })
  .openapi('CloudflareSaasImageDomainSettings')

export const manualImageDomainSettingsSchema = imageDomainSettingsBaseSchema
  .extend({
    provider: z.literal('manual'),
    manual: z.object({
      records: z.array(imageDomainDnsRecordSchema).min(1),
    }),
  })
  .openapi('ManualImageDomainSettings')

export const emptyImageDomainSettingsSchema = z
  .object({
    enabled: z.literal(false),
    provider: z.null(),
  })
  .openapi('EmptyImageDomainSettings')

export const imageDomainSettingsSchema = z
  .union([cloudflareSaasImageDomainSettingsSchema, manualImageDomainSettingsSchema, emptyImageDomainSettingsSchema])
  .openapi('ImageDomainSettings')

export const updateImageDomainSettingsSchema = z
  .discriminatedUnion('provider', [cloudflareSaasImageDomainSettingsSchema, manualImageDomainSettingsSchema])
  .openapi('UpdateImageDomainSettings')

export const imageDomainProviderStatusSchema = z
  .enum(['disabled', 'unverified', 'ready', 'error'])
  .openapi('ImageDomainProviderStatus')

export const imageDomainProviderResponseSchema = z
  .object({
    settings: imageDomainSettingsSchema,
    status: imageDomainProviderStatusSchema,
    lastTestedAt: z.iso.datetime().nullable(),
    error: z.string().nullable(),
    domains: z.array(
      z.object({
        orgId: opaqueIdSchema,
        hostname: z.string(),
        provider: z.enum(['cloudflare_saas', 'manual']).nullable(),
        status: z.enum(['pending_dns', 'pending_tls', 'verified', 'failed']).nullable(),
        error: z.string().nullable(),
        lastCheckedAt: z.iso.datetime().nullable(),
      }),
    ),
  })
  .openapi('ImageDomainProviderResponse')

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
export const updateSiteWebDavSchema = z
  .object({
    enabled: z.boolean(),
    domain: z
      .string()
      .trim()
      .refine(
        (value) =>
          value === '' ||
          (value.length <= 253 &&
            /^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)(?:\.(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?))*$/i.test(value)),
        'WebDAV domain must be a hostname without a protocol, port, or path',
      ),
  })
  .openapi('UpdateSiteWebDav')

export type SiteConfig = z.infer<typeof siteConfigSchema>
export type SiteBranding = z.infer<typeof siteBrandingSchema>
export type SiteSettings = z.infer<typeof siteSettingsSchema>
export type SiteIdentitySettings = z.infer<typeof siteIdentitySettingsSchema>
export type SiteRegistrationSettings = z.infer<typeof siteRegistrationSettingsSchema>
export type SiteCaptchaSettings = z.infer<typeof siteCaptchaSettingsSchema>
export type SiteQuotaSettings = z.infer<typeof siteQuotaSettingsSchema>
export type SiteWebDavSettings = z.infer<typeof siteWebDavSettingsSchema>
export type EmailSettings = z.infer<typeof emailSettingsSchema>
export type UpdateEmailSettingsInput = z.infer<typeof updateEmailSettingsSchema>
export type CreateTestEmailInput = z.infer<typeof createTestEmailSchema>
export type ImageDomainDnsRecord = z.infer<typeof imageDomainDnsRecordSchema>
export type ImageDomainSettings = z.infer<typeof imageDomainSettingsSchema>
export type UpdateImageDomainSettingsInput = z.infer<typeof updateImageDomainSettingsSchema>
export type ImageDomainProviderResponse = z.infer<typeof imageDomainProviderResponseSchema>
export type UpdateSiteIdentityInput = z.infer<typeof updateSiteIdentitySchema>
export type UpdateSiteRegistrationInput = z.infer<typeof updateSiteRegistrationSchema>
export type UpdateSiteCaptchaInput = z.infer<typeof updateSiteCaptchaSchema>
export type UpdateSiteQuotasInput = z.infer<typeof updateSiteQuotasSchema>
export type UpdateSiteWebDavInput = z.infer<typeof updateSiteWebDavSchema>
