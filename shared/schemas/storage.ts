import { z } from 'zod'

export const createStorageSchema = z.object({
  provider: z.string().default(''),
  bucket: z.string().min(1),
  endpoint: z.string().url(),
  region: z.string().default('auto'),
  accessKey: z.string().min(1),
  secretKey: z.string().min(1),
  customHost: z.string().optional(),
  capacity: z.number().int().min(0).default(0),
  forcePathStyle: z.boolean().default(true),
  egressCreditBillingEnabled: z.boolean().default(false),
  egressCreditUnitBytes: z.number().int().positive().default(104857600),
  egressCreditPerUnit: z.number().int().positive().default(1),
})

export const replaceStorageSchema = z.object({
  provider: z.string(),
  bucket: z.string().min(1),
  endpoint: z.string().url(),
  region: z.string(),
  accessKey: z.string().min(1),
  secretKey: z.string().min(1),
  customHost: z.string().optional(),
  capacity: z.number().int().min(0),
  forcePathStyle: z.boolean(),
  egressCreditBillingEnabled: z.boolean(),
  egressCreditUnitBytes: z.number().int().positive(),
  egressCreditPerUnit: z.number().int().positive(),
  enabled: z.boolean(),
})

export const patchStorageSchema = z
  .object({
    provider: z.string().optional(),
    bucket: z.string().min(1).optional(),
    endpoint: z.string().url().optional(),
    region: z.string().optional(),
    accessKey: z.string().min(1).optional(),
    secretKey: z.string().min(1).optional(),
    customHost: z.string().optional(),
    capacity: z.number().int().min(0).optional(),
    forcePathStyle: z.boolean().optional(),
    egressCreditBillingEnabled: z.boolean().optional(),
    egressCreditUnitBytes: z.number().int().positive().optional(),
    egressCreditPerUnit: z.number().int().positive().optional(),
    enabled: z.boolean().optional(),
    status: z.enum(['unknown', 'healthy', 'unhealthy']).optional(),
    statusReason: z
      .enum(['cors', 'authentication_failed', 'permission_denied', 'bucket_not_found', 'network_error', 'unknown'])
      .nullable()
      .optional(),
  })
  .refine((input) => Object.keys(input).length > 0, { message: 'At least one field is required' })
  .refine(
    (input) =>
      input.status === undefined ||
      !['provider', 'bucket', 'endpoint', 'region', 'accessKey', 'secretKey', 'forcePathStyle'].some(
        (field) => field in input,
      ),
    { message: 'Health status cannot be updated with connection settings' },
  )
  .superRefine((input, ctx) => {
    if (input.status === undefined && input.statusReason !== undefined) {
      ctx.addIssue({ code: 'custom', message: 'Health reason requires a health status', path: ['statusReason'] })
      return
    }
    if (input.status === 'unhealthy' && input.statusReason == null) {
      ctx.addIssue({ code: 'custom', message: 'Unhealthy status requires a reason', path: ['statusReason'] })
    }
    if (input.status !== undefined && input.status !== 'unhealthy' && input.statusReason != null) {
      ctx.addIssue({
        code: 'custom',
        message: 'Only an unhealthy status can have a reason',
        path: ['statusReason'],
      })
    }
  })

export const updateStorageEgressBillingSchema = z.object({
  enabled: z.boolean(),
  unitBytes: z.number().int().positive(),
  creditsPerUnit: z.number().int().positive(),
})

export type CreateStorageInput = z.input<typeof createStorageSchema>
export type ReplaceStorageInput = z.input<typeof replaceStorageSchema>
export type PatchStorageInput = z.input<typeof patchStorageSchema>
export type UpdateStorageEgressBillingInput = z.input<typeof updateStorageEgressBillingSchema>
