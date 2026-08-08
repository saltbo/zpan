import { describe, expect, it } from 'vitest'
import { apikey, oauthClient } from '../../db/auth-schema'
import { downloaders } from '../../db/schema'
import { createTestApp } from '../../test/setup'
import { createAuditActorDirectoryRepo } from './audit-actor-directory'

describe('audit actor directory repository', () => {
  it('resolves API key names in one local lookup', async () => {
    const { db } = await createTestApp()
    await db.insert(apikey).values({
      id: 'key-1',
      configId: 'remote-download',
      name: 'CME downloader',
      referenceId: 'user-1',
      key: 'hashed-secret',
      createdAt: new Date(0),
      updatedAt: new Date(0),
    })
    const directory = createAuditActorDirectoryRepo(db)

    await expect(directory.findApiKeyNames(['key-1', 'missing'])).resolves.toEqual(
      new Map([['key-1', 'CME downloader']]),
    )
  })

  it('resolves device names in one local lookup', async () => {
    const { db } = await createTestApp()
    await db.insert(downloaders).values({
      id: 'device-1',
      name: 'Office Mac',
      tokenHash: 'hashed-token',
      tokenJti: 'device-token-jti',
      createdBy: 'user-1',
      createdAt: new Date(0),
      updatedAt: new Date(0),
    })
    const directory = createAuditActorDirectoryRepo(db)

    await expect(directory.findDeviceNames(['device-1', 'missing'])).resolves.toEqual(
      new Map([['device-1', 'Office Mac']]),
    )
  })

  it('trusts only secure issuer origins backed by an enabled registered client', async () => {
    const { db } = await createTestApp()
    await db.insert(oauthClient).values([
      {
        id: 'oauth-client-enabled',
        clientId: 'realmroot',
        redirectUris: '[]',
        jwksUri: 'https://id.realmroot.dev/api/auth/jwks',
      },
      {
        id: 'oauth-client-disabled',
        clientId: 'disabled',
        redirectUris: '[]',
        jwksUri: 'https://disabled.example/jwks',
        disabled: true,
      },
      {
        id: 'oauth-client-insecure',
        clientId: 'insecure',
        redirectUris: '[]',
        jwksUri: 'http://issuer.example/jwks',
      },
    ])
    const directory = createAuditActorDirectoryRepo(db)

    await expect(directory.listTrustedAgentIssuerOrigins()).resolves.toEqual(new Set(['https://id.realmroot.dev']))
  })
})
