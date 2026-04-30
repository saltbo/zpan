import { ZPAN_CLOUD_URL_DEFAULT } from '@shared/constants'
import type { LicenseAssertion } from '@shared/types'
import { verify } from 'paseto-ts/v4'
import { PUBLIC_KEYS } from './public-keys'

export interface VerifyCertificateOptions {
  instanceId: string
  currentHost?: string | null
  cloudBaseUrl?: string | null
}

export function trustedIssuerFromCloudUrl(baseUrl: string | null | undefined): string {
  const raw = baseUrl || ZPAN_CLOUD_URL_DEFAULT
  try {
    return new URL(raw).origin
  } catch {
    return new URL(ZPAN_CLOUD_URL_DEFAULT).origin
  }
}

export function normalizeHost(host: string | null | undefined): string | null {
  if (!host) return null
  try {
    return new URL(host.includes('://') ? host : `http://${host}`).host.toLowerCase()
  } catch {
    return host.split('/')[0]?.toLowerCase() || null
  }
}

export function verifyCertificate(cert: string, options: VerifyCertificateOptions): LicenseAssertion | null {
  for (const key of PUBLIC_KEYS) {
    const assertion = tryVerify(cert, key, options)
    if (assertion !== null) {
      return assertion
    }
  }
  return null
}

function tryVerify(cert: string, publicKey: string, options: VerifyCertificateOptions): LicenseAssertion | null {
  try {
    const { payload } = verify<LicenseAssertion>(publicKey, cert, { validatePayload: false })
    const now = Math.floor(Date.now() / 1000)
    const currentHost = normalizeHost(options.currentHost)
    const authorizedHosts = Array.isArray(payload.authorizedHosts)
      ? payload.authorizedHosts.map((host) => normalizeHost(host)).filter((host): host is string => Boolean(host))
      : []

    if (payload.type !== 'zpan.license') {
      return null
    }

    if (payload.issuer !== trustedIssuerFromCloudUrl(options.cloudBaseUrl)) {
      return null
    }

    if (payload.instanceId !== options.instanceId || payload.edition !== 'pro') {
      return null
    }

    if (payload.notBefore > now || payload.expiresAt <= now) {
      return null
    }

    if (currentHost && !authorizedHosts.includes(currentHost)) {
      return null
    }

    return { ...payload, authorizedHosts }
  } catch {
    return null
  }
}
