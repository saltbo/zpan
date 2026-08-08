import {
  type AgentInfoGateway,
  type AuditActorDirectory,
  type AuditActorIdentity,
  type AuditActorProfile,
  type AuditEventWithUser,
  auditActorIdentityKey,
} from './ports'

export async function resolveAuditActorProfiles<T extends AuditEventWithUser>(
  deps: { auditActorDirectory: AuditActorDirectory; agentInfo: AgentInfoGateway },
  events: T[],
): Promise<T[]> {
  const identities = uniqueResolvableIdentities(events)
  if (identities.length === 0) return events

  const profiles = await resolveProfiles(deps, identities)
  return events.map((event) => {
    const profile = profiles.get(
      auditActorIdentityKey({ type: event.actorType, ref: event.actorRef, issuer: event.actorIssuer }),
    )
    return profile ? { ...event, actor: profile } : event
  })
}

async function resolveProfiles(
  deps: { auditActorDirectory: AuditActorDirectory; agentInfo: AgentInfoGateway },
  identities: readonly AuditActorIdentity[],
): Promise<ReadonlyMap<string, AuditActorProfile>> {
  const profiles = new Map<string, AuditActorProfile>()
  const apiKeyActors = identities.flatMap((identity) =>
    identity.type === 'api_key' && identity.ref ? [{ identity, ref: identity.ref }] : [],
  )
  if (apiKeyActors.length > 0) {
    const names = await deps.auditActorDirectory.findApiKeyNames(apiKeyActors.map((actor) => actor.ref))
    for (const actor of apiKeyActors) {
      const name = names.get(actor.ref)
      if (name)
        profiles.set(auditActorIdentityKey(actor.identity), {
          name: `API key · ${name}`,
          image: null,
          resolved: true,
        })
    }
  }

  const deviceActors = identities.flatMap((identity) =>
    identity.type === 'device' && identity.ref ? [{ identity, ref: identity.ref }] : [],
  )
  if (deviceActors.length > 0) {
    const names = await deps.auditActorDirectory.findDeviceNames(deviceActors.map((actor) => actor.ref))
    for (const actor of deviceActors) {
      const name = names.get(actor.ref)
      if (name)
        profiles.set(auditActorIdentityKey(actor.identity), {
          name: `Device · ${name}`,
          image: null,
          resolved: true,
        })
    }
  }

  const agentActors = identities.filter(
    (identity) => (identity.type === 'oauth' || identity.type === 'agent') && identity.ref && identity.issuer,
  )
  if (agentActors.length > 0) {
    const trustedOrigins = await deps.auditActorDirectory.listTrustedAgentIssuerOrigins()
    const agentProfiles = await deps.agentInfo.resolve(agentActors, trustedOrigins)
    for (const [key, profile] of agentProfiles) profiles.set(key, profile)
  }
  return profiles
}

function uniqueResolvableIdentities(events: readonly AuditEventWithUser[]): AuditActorIdentity[] {
  const identities = new Map<string, AuditActorIdentity>()
  for (const event of events) {
    if (
      event.actorType !== 'api_key' &&
      event.actorType !== 'device' &&
      event.actorType !== 'oauth' &&
      event.actorType !== 'agent'
    )
      continue
    if (!event.actorRef) continue
    const identity = { type: event.actorType, ref: event.actorRef, issuer: event.actorIssuer }
    identities.set(auditActorIdentityKey(identity), identity)
  }
  return [...identities.values()]
}
