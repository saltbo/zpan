import type { LicenseHostPolicy } from './types/licensing'

const label = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/

export function isLicenseHostPolicy(value: unknown): value is LicenseHostPolicy {
  if (!value || typeof value !== 'object') return false
  const p = value as Record<string, unknown>
  return (
    p.type === 'worker-preview' &&
    typeof p.worker === 'string' &&
    label.test(p.worker) &&
    typeof p.account === 'string' &&
    label.test(p.account)
  )
}

export function matchesLicenseHostPolicy(policy: LicenseHostPolicy, host: string): boolean {
  if (!isLicenseHostPolicy(policy)) return false
  const parts = host.toLowerCase().split('.')
  if (parts.length !== 4 || parts[1] !== policy.account || parts[2] !== 'workers' || parts[3] !== 'dev') return false
  const first = parts[0]!
  const suffix = `-${policy.worker}`
  return label.test(first) && first.endsWith(suffix) && first.length > suffix.length
}
