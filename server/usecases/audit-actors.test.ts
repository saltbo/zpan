import { describe, expect, it, vi } from 'vitest'
import { resolveActorAttributions } from './audit-actors'
import { type ActorIdentity, actorIdentityKey } from './ports'

describe('resolveActorAttributions', () => {
  it('resolves user, API key, device, and agent identities through the shared directory', async () => {
    const identities: ActorIdentity[] = [
      { type: 'user', ref: 'user-1', issuer: null },
      { type: 'api_key', ref: 'key-1', issuer: null },
      { type: 'device', ref: 'device-1', issuer: null },
      { type: 'agent', ref: 'agent-1', issuer: 'https://realm.example.com' },
    ]
    const resolve = vi.fn(
      async () =>
        new Map([
          [
            actorIdentityKey(identities[3]!),
            { name: 'Media Agent', image: 'https://realm.example.com/avatar.png', resolved: true },
          ],
        ]),
    )

    const actors = await resolveActorAttributions(
      {
        auditActorDirectory: {
          findUserProfiles: async () =>
            new Map([['user-1', { name: 'Amber', image: 'https://example.com/amber.png', resolved: true }]]),
          findApiKeyNames: async () => new Map([['key-1', 'zme']]),
          findDeviceNames: async () => new Map([['device-1', 'zpan-downloader']]),
          listTrustedAgentIssuerOrigins: async () => new Set(['https://realm.example.com']),
        },
        agentInfo: { resolve },
      },
      identities,
    )

    expect(actors.get(actorIdentityKey(identities[0]!))).toMatchObject({ name: 'Amber', image: expect.any(String) })
    expect(actors.get(actorIdentityKey(identities[1]!))).toMatchObject({ name: 'API key · zme', resolved: true })
    expect(actors.get(actorIdentityKey(identities[2]!))).toMatchObject({
      name: 'Device · zpan-downloader',
      resolved: true,
    })
    expect(actors.get(actorIdentityKey(identities[3]!))).toMatchObject({ name: 'Media Agent', resolved: true })
  })

  it('keeps a stable identity fallback when display metadata is unavailable', async () => {
    const identity: ActorIdentity = { type: 'agent', ref: 'agent-missing', issuer: 'https://realm.example.com' }

    const actors = await resolveActorAttributions(
      {
        auditActorDirectory: {
          findUserProfiles: async () => new Map(),
          findApiKeyNames: async () => new Map(),
          findDeviceNames: async () => new Map(),
          listTrustedAgentIssuerOrigins: async () => new Set(),
        },
        agentInfo: { resolve: async () => new Map() },
      },
      [identity],
    )

    expect(actors.get(actorIdentityKey(identity))).toEqual({
      ...identity,
      name: 'Agent · agent-missing',
      image: null,
      resolved: false,
    })
  })
})
