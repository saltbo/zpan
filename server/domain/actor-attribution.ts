import type { ActorAttribution } from '@shared/schemas'

type ActorIdentity = Pick<ActorAttribution, 'type' | 'ref' | 'issuer'>
type ActorProfile = Pick<ActorAttribution, 'name' | 'image' | 'resolved'>

export function fallbackActorProfile(identity: ActorIdentity): ActorProfile {
  const ref = identity.ref ?? 'unknown'
  const labels: Partial<Record<ActorIdentity['type'], string>> = {
    user: 'User',
    api_key: 'API key',
    oauth: 'Agent',
    agent: 'Agent',
    device: 'Device',
    system: 'System',
    anonymous: 'Anonymous',
    'task-upload': 'Task upload',
  }
  return { name: `${labels[identity.type] ?? 'Actor'} · ${ref}`, image: null, resolved: false }
}

export function fallbackActorAttribution(identity: ActorIdentity): ActorAttribution {
  return { ...identity, ...fallbackActorProfile(identity) }
}
