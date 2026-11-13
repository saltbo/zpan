// @vitest-environment node
import { generateKeys } from 'paseto-ts/v4'
import { afterEach, describe, expect, it } from 'vitest'
import { getBuiltinLicenseKeys, getTrustedLicenseKeys } from '../domain/license-keys'
import { createNodePlatform } from './node'

describe('license key trust ignores the environment', () => {
  const previous = { keys: process.env.ZPAN_LICENSE_PUBLIC_KEYS, db: process.env.DATABASE_URL }

  afterEach(() => {
    if (previous.keys === undefined) delete process.env.ZPAN_LICENSE_PUBLIC_KEYS
    else process.env.ZPAN_LICENSE_PUBLIC_KEYS = previous.keys
    if (previous.db === undefined) delete process.env.DATABASE_URL
    else process.env.DATABASE_URL = previous.db
  })

  it('does not trust ZPAN_LICENSE_PUBLIC_KEYS on the Node platform', () => {
    const { publicKey } = generateKeys('public')
    process.env.ZPAN_LICENSE_PUBLIC_KEYS = publicKey
    process.env.DATABASE_URL = ':memory:'

    createNodePlatform()

    expect(getTrustedLicenseKeys().map((key) => key.publicKey)).not.toContain(publicKey)
    expect(getTrustedLicenseKeys()).toEqual([...getBuiltinLicenseKeys()])
  })
})
