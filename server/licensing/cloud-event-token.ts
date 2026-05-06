import { verify } from 'paseto-ts/v4'
import { z } from 'zod'
import { PUBLIC_KEYS } from './public-keys'
import { trustedIssuerFromCloudUrl } from './verify'

const CLOUD_EVENT_TOKEN_MAX_TTL_SECONDS = 5 * 60

const cloudEventTokenSchema = z.object({
  type: z.literal('zpan.cloud.event'),
  purpose: z.literal('quota_store.delivery'),
  issuer: z.string().min(1),
  audience: z.string().min(1),
  boundLicenseId: z.string().min(1),
  eventId: z.string().min(1),
  payloadHash: z.string().regex(/^[0-9a-f]{64}$/i),
  issuedAt: z.number().int(),
  notBefore: z.number().int().optional(),
  expiresAt: z.number().int(),
})

export type CloudEventToken = z.infer<typeof cloudEventTokenSchema>

export interface VerifyCloudEventTokenOptions {
  cloudBaseUrl: string
  instanceId: string
  boundLicenseId: string
  payloadHash: string
}

export function verifyCloudEventToken(token: string, options: VerifyCloudEventTokenOptions): CloudEventToken | null {
  for (const key of PUBLIC_KEYS) {
    const event = tryVerifyCloudEventToken(token, key, options)
    if (event) return event
  }
  return null
}

function tryVerifyCloudEventToken(
  token: string,
  publicKey: string,
  options: VerifyCloudEventTokenOptions,
): CloudEventToken | null {
  try {
    const { payload } = verify<Record<string, unknown>>(publicKey, token, { validatePayload: false })
    const parsed = cloudEventTokenSchema.safeParse(payload)
    if (!parsed.success) return null

    const event = parsed.data
    const now = Math.floor(Date.now() / 1000)
    if (event.issuer !== trustedIssuerFromCloudUrl(options.cloudBaseUrl)) return null
    if (event.audience !== options.instanceId) return null
    if (event.boundLicenseId !== options.boundLicenseId) return null
    if (event.payloadHash !== options.payloadHash) return null
    if (event.issuedAt > now) return null
    if (event.notBefore && event.notBefore > now) return null
    if (event.expiresAt <= now) return null
    if (event.expiresAt - event.issuedAt > CLOUD_EVENT_TOKEN_MAX_TTL_SECONDS) return null

    return event
  } catch {
    return null
  }
}
