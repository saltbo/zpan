// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { getTrustedLicenseKeys } from '../../domain/license-keys'
import { verifyCertificateResult } from './licensing'

const STAGING_CLOUD_URL = 'https://staging-zpan-cloud.saltbo.workers.dev'
const STAGING_PUBLIC_KEY = 'k4.public.1wNfC6XwZPu991UOy5VrdxENoLJmpmwUf3ELy4pcX4w'

// A real entitlement certificate issued by staging Cloud for a Workers preview,
// captured 2026-11-12. It carries a hostPolicy claim with an empty authorizedHosts
// list. Its claims hold only opaque staging IDs and it expired 24 h after issue, so
// it is safe to commit.
const STAGING_ISSUED_CERT =
  'v4.public.eyJ0eXBlIjoienBhbi5saWNlbnNlIiwiaXNzdWVyIjoiaHR0cHM6Ly9zdGFnaW5nLXpwYW4tY2xvdWQuc2FsdGJvLndvcmtlcnMuZGV2Iiwic3ViamVjdCI6IjNmMDFiZmI5LTJmYTktNGU0NS04MzFhLWQ1Y2UyNjEzMjdlNyIsImFjY291bnRJZCI6IklJMFo5UjFMU3Rlc2t2b0FnMEpkbnZKcXJOTzZZQlVGIiwiaW5zdGFuY2VJZCI6ImM3R0RsTTRxMG02cVRscnVSdHZFMCIsInN0b3JlSWQiOiI5OGIzZDdhMC1hYjk5LTRiYTItOWEzNC1jYTg3YmU3MjkzZGYiLCJlZGl0aW9uIjoiYnVzaW5lc3MiLCJmZWF0dXJlcyI6WyJ3aGl0ZV9sYWJlbCIsIm9wZW5fcmVnaXN0cmF0aW9uIiwidGVhbXNfdW5saW1pdGVkIiwic3RvcmFnZXNfdW5saW1pdGVkIiwic2l0ZV9hbm5vdW5jZW1lbnRzIiwiYXVkaXRfbG9nIiwicXVvdGFfc3RvcmUiXSwibGljZW5zZUlkIjoiYTI0MGQ3NzgtY2NkNi00YWJlLWIwMjUtYzlhMTUxODY4YzUwIiwibGljZW5zZUtpbmQiOiJzdWJzY3JpcHRpb24iLCJob3N0UG9saWN5Ijp7InR5cGUiOiJ3b3JrZXItcHJldmlldyIsIndvcmtlciI6InpwYW4iLCJhY2NvdW50Ijoic2FsdGJvIn0sImF1dGhvcml6ZWRIb3N0cyI6W10sImxpY2Vuc2VWYWxpZFVudGlsIjoxODEwMDY3OTI3LCJpc3N1ZWRBdCI6MTc5NDUxNzI3MCwibm90QmVmb3JlIjoxNzk0NTE3MjcwLCJleHBpcmVzQXQiOjE3OTQ2MDM2NzB9OrNnol6eOQKAfzY4xaeVpcZuA7EKv3GGKj-t0q-AUSeIT5pM6x_ZfRg94RAoiEAPFSV9OeA7ez9P0pMNjwYuAA'
const STAGING_CERT_ISSUED_AT = 1794517270
const STAGING_CERT_INSTANCE_ID = 'c7GDlM4q0m6qTlruRtvE0'

describe('builtin staging license key', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime((STAGING_CERT_ISSUED_AT + 60) * 1000)
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('trusts the current staging key', () => {
    expect(getTrustedLicenseKeys().map((key) => key.publicKey)).toContain(STAGING_PUBLIC_KEY)
    expect(getTrustedLicenseKeys().map((key) => key.publicKey)).not.toContain(
      'k4.public.CCpUZ1yRWkFQy4fPZAblCYfzeJn4vDwPQrjtfiySwFc',
    )
  })

  it('verifies a staging-issued certificate with the builtin staging key', () => {
    const result = verifyCertificateResult(STAGING_ISSUED_CERT, {
      instanceId: STAGING_CERT_INSTANCE_ID,
      cloudBaseUrl: STAGING_CLOUD_URL,
    })

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.assertion.issuer).toBe(STAGING_CLOUD_URL)
    expect(result.assertion.edition).toBe('business')
  })

  it('does not authorize a preview host from the hostPolicy claim', () => {
    const result = verifyCertificateResult(STAGING_ISSUED_CERT, {
      instanceId: STAGING_CERT_INSTANCE_ID,
      cloudBaseUrl: STAGING_CLOUD_URL,
      currentHost: 'pr-600-zpan.saltbo.workers.dev',
    })

    expect(result).toEqual({ ok: false, reason: 'host' })
  })

  it('rejects the staging certificate when the configured cloud is production', () => {
    const result = verifyCertificateResult(STAGING_ISSUED_CERT, {
      instanceId: STAGING_CERT_INSTANCE_ID,
      cloudBaseUrl: 'https://cloud.zpan.space',
    })

    expect(result).toEqual({ ok: false, reason: 'issuer' })
  })

  it('rejects the staging certificate when it is tampered with', () => {
    const result = verifyCertificateResult(`${STAGING_ISSUED_CERT}x`, {
      instanceId: STAGING_CERT_INSTANCE_ID,
      cloudBaseUrl: STAGING_CLOUD_URL,
    })

    expect(result).toEqual({ ok: false, reason: 'signature' })
  })
})
