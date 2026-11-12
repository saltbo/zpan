import { generateKeys, sign } from 'paseto-ts/v4'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createLicenseBindingRepo } from '../../adapters/repos/license-binding'
import { PUBLIC_KEYS } from '../../domain/license-keys'
import { createTestApp } from '../../test/setup'
import { checkTeamLimit, loadBindingState, resolveEffectiveSignupMode } from './licensing'

const { secretKey, publicKey } = generateKeys('public')
beforeAll(() => {
  PUBLIC_KEYS.push(publicKey)
})
afterAll(() => {
  const index = PUBLIC_KEYS.indexOf(publicKey)
  if (index !== -1) PUBLIC_KEYS.splice(index, 1)
})
const nowSec = () => Math.floor(Date.now() / 1000)
function signCert({ issuer }: { issuer: string }) {
  return sign(secretKey, {
    type: 'zpan.license',
    issuer,
    subject: 'bind-1',
    accountId: 'acct-1',
    instanceId: 'inst-abc',
    edition: 'pro',
    authorizedHosts: ['zpan.example.com'],
    licenseValidUntil: nowSec() + 3600,
    issuedAt: nowSec(),
    notBefore: nowSec(),
    expiresAt: nowSec() + 3600,
  })
}

describe('configured Cloud issuer across feature gates', () => {
  it('uses the configured staging issuer for binding state, teams and signup without changing the production default', async () => {
    const { db } = await createTestApp()
    const licenseBinding = createLicenseBindingRepo(db)
    const issuer = 'https://staging-zpan-cloud.saltbo.workers.dev'
    await licenseBinding.createLicenseBinding({
      cloudBindingId: 'bind-1',
      instanceId: 'inst-abc',
      cloudAccountId: 'acct-1',
      refreshToken: 'synthetic-refresh-token',
      cachedCert: signCert({ issuer }),
      cachedExpiresAt: nowSec() + 3600,
      lastRefreshAt: nowSec(),
    })
    const deps = { licenseBinding, licenseCloudBaseUrl: issuer }
    expect(await loadBindingState(deps)).toMatchObject({ bound: true, active: true, edition: 'pro' })
    expect(await resolveEffectiveSignupMode(deps, 'open')).toBe('open')
    expect(await checkTeamLimit({ ...deps, memberCount: { countUserOrgs: async () => 2 } }, 'user')).toMatchObject({
      allowed: true,
    })
    expect(await loadBindingState({ licenseBinding })).toMatchObject({ bound: true, active: false })
    expect(await loadBindingState(deps, { cloudBaseUrl: 'https://unrelated.example.com' })).toMatchObject({
      active: false,
    })
  })
})
