import { z } from 'zod'

export const createStorageSchema = z.object({
  title: z.string().min(1),
  bucket: z.string().min(1),
  endpoint: z.string().url(),
  region: z.string().default('auto'),
  accessKey: z.string().min(1),
  secretKey: z.string().min(1),
  customHost: z.string().optional(),
  capacity: z.number().int().min(0).default(0),
  egressCreditBillingEnabled: z.boolean().default(false),
  egressCreditUnitBytes: z.number().int().positive().default(104857600),
  egressCreditPerUnit: z.number().int().positive().default(1),
})

export const updateStorageSchema = z.object({
  title: z.string().min(1).optional(),
  bucket: z.string().min(1).optional(),
  endpoint: z.string().url().optional(),
  region: z.string().optional(),
  accessKey: z.string().min(1).optional(),
  secretKey: z.string().min(1).optional(),
  customHost: z.string().optional(),
  capacity: z.number().int().min(0).optional(),
  egressCreditBillingEnabled: z.boolean().optional(),
  egressCreditUnitBytes: z.number().int().positive().optional(),
  egressCreditPerUnit: z.number().int().positive().optional(),
  status: z.enum(['active', 'disabled']).optional(),
})

export type CreateStorageInput = z.input<typeof createStorageSchema>
export type UpdateStorageInput = z.input<typeof updateStorageSchema>
