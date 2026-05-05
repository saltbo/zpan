import { z } from 'zod'

export const quotaStoreSettingsSchema = z.object({
  enabled: z.boolean(),
  cloudBaseUrl: z.string().url(),
  publicInstanceUrl: z.string().url(),
  webhookSigningSecret: z.string().min(1).optional(),
})

export const quotaStorePackageInputSchema = z.object({
  name: z.string().min(1).max(120),
  description: z.string().max(1000).default(''),
  bytes: z.number().int().positive(),
  amount: z.number().int().positive(),
  currency: z
    .string()
    .min(3)
    .max(12)
    .transform((v) => v.toLowerCase()),
  active: z.boolean().default(true),
  sortOrder: z.number().int().default(0),
})

export const checkoutInputSchema = z.object({
  packageId: z.string().min(1),
  targetOrgId: z.string().min(1),
})

export const redemptionInputSchema = z.object({
  code: z.string().min(1),
  targetOrgId: z.string().min(1),
})

export const cloudDeliveryEventSchema = z
  .object({
    eventId: z.string().min(1),
    cloudOrderId: z.string().min(1),
    orgId: z.string().min(1),
    packageId: z.string().min(1).optional(),
    source: z.enum(['stripe', 'redeem_code', 'admin_adjustment']),
    code: z.string().min(1).optional(),
    bytes: z.number().int().positive(),
    terminalUserId: z.string().optional(),
    terminalUserEmail: z.string().email().optional(),
  })
  .superRefine((event, ctx) => {
    if (event.source === 'stripe' && !event.packageId) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['packageId'],
        message: 'packageId is required for stripe deliveries',
      })
    }
    if (event.source === 'redeem_code' && !event.code) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['code'],
        message: 'code is required for redeem_code deliveries',
      })
    }
  })

export type QuotaStoreSettingsInput = z.infer<typeof quotaStoreSettingsSchema>
export type QuotaStorePackageInput = z.infer<typeof quotaStorePackageInputSchema>
export type CheckoutInput = z.infer<typeof checkoutInputSchema>
export type RedemptionInput = z.infer<typeof redemptionInputSchema>
export type CloudDeliveryEvent = z.infer<typeof cloudDeliveryEventSchema>
