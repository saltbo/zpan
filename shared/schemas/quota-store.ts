import { z } from 'zod'

export const quotaStoreSettingsSchema = z.object({
  enabled: z.boolean(),
})

export const quotaStorePackageInputSchema = z.object({
  name: z.string().min(1).max(120),
  description: z.string().max(1000).default(''),
  bytes: z.number().int().positive(),
  amount: z.number().int().positive(),
  currency: z.enum(['usd', 'cny']),
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
    cloudOrderId: z.string().min(1).optional(),
    cloudRedemptionId: z.string().min(1).optional(),
    targetOrgId: z.string().min(1),
    packageId: z.string().min(1).optional(),
    package: z
      .object({
        id: z.string().min(1),
        name: z.string().min(1),
        description: z.string().nullable(),
        bytes: z.number().int().positive(),
        amount: z.number().int().positive(),
        currency: z.enum(['usd', 'cny']),
      })
      .optional(),
    source: z.enum(['stripe', 'redeem_code', 'admin_adjustment']),
    code: z.string().min(1).optional(),
    bytes: z.number().int().positive(),
    occurredAt: z.string().min(1).optional(),
    terminalUserId: z.string().optional(),
    terminalUserEmail: z.string().email().optional(),
  })
  .superRefine((event, ctx) => {
    if (event.source === 'stripe' && (!event.cloudOrderId || !event.packageId)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['cloudOrderId'],
        message: 'order and package id are required for stripe deliveries',
      })
    }
    if (event.source === 'redeem_code' && !event.cloudRedemptionId) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['cloudRedemptionId'],
        message: 'cloudRedemptionId is required for redeem_code deliveries',
      })
    }
  })

export type QuotaStoreSettingsInput = z.infer<typeof quotaStoreSettingsSchema>
export type QuotaStorePackageInput = z.infer<typeof quotaStorePackageInputSchema>
export type CheckoutInput = z.infer<typeof checkoutInputSchema>
export type RedemptionInput = z.infer<typeof redemptionInputSchema>
export type CloudDeliveryEvent = z.infer<typeof cloudDeliveryEventSchema>
