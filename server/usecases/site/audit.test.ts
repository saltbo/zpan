import { describe, expect, it, vi } from 'vitest'
import { type AdminAuditEventWithOrg, type AgentInfoGateway, type AuditRepo, auditActorIdentityKey } from '../ports'
import { listAuditEvents } from './audit'

describe('audit usecase', () => {
  it('forwards the query options to listAdminAudit', async () => {
    const result = { items: [], total: 0, page: 1, pageSize: 20 }
    const listAdminAudit = vi.fn(async () => result)
    const resolve = vi.fn(async () => new Map())
    const findApiKeyNames = vi.fn(async () => new Map())
    const findDeviceNames = vi.fn(async () => new Map())
    const listTrustedAgentIssuerOrigins = vi.fn(async () => new Set<string>())
    const out = await listAuditEvents(
      {
        audit: { listAdminAudit } as Pick<AuditRepo, 'listAdminAudit'>,
        auditActorDirectory: { findApiKeyNames, findDeviceNames, listTrustedAgentIssuerOrigins },
        agentInfo: { resolve } as AgentInfoGateway,
      },
      {
        page: 1,
        pageSize: 20,
        orgId: 'o1',
      },
    )
    expect(out).toBe(result)
    expect(listAdminAudit).toHaveBeenCalledWith({ page: 1, pageSize: 20, orgId: 'o1' })
    expect(resolve).not.toHaveBeenCalled()
    expect(findApiKeyNames).not.toHaveBeenCalled()
    expect(findDeviceNames).not.toHaveBeenCalled()
    expect(listTrustedAgentIssuerOrigins).not.toHaveBeenCalled()
  })

  it('uses the resolved Agent profile without replacing the delegated user', async () => {
    const event = {
      id: 'e1',
      orgId: 'o1',
      orgName: 'Personal',
      userId: 'u1',
      actorType: 'oauth',
      actorRef: 'agt_1',
      actorIssuer: 'https://id.realmroot.dev/api/auth',
      action: 'upload',
      targetType: 'file',
      targetId: 'f1',
      targetName: 'agent.txt',
      metadata: null,
      createdAt: new Date(0),
      user: { id: 'u1', name: 'Ambor', image: null },
      actor: { name: 'Agent · agt_1', image: null, resolved: false },
    } satisfies AdminAuditEventWithOrg
    const identity = { type: 'oauth', ref: 'agt_1', issuer: 'https://id.realmroot.dev/api/auth' } as const
    const resolved = { name: 'Mac Agent', image: 'https://id.realmroot.dev/agent.svg', resolved: true }
    const resolve = vi.fn(async () => new Map([[auditActorIdentityKey(identity), resolved]]))

    const out = await listAuditEvents(
      {
        audit: { listAdminAudit: async () => ({ items: [event], total: 1, page: 1, pageSize: 20 }) },
        auditActorDirectory: {
          findApiKeyNames: async () => new Map(),
          findDeviceNames: async () => new Map(),
          listTrustedAgentIssuerOrigins: async () => new Set(['https://id.realmroot.dev']),
        },
        agentInfo: { resolve },
      },
      { page: 1, pageSize: 20 },
    )

    expect(out.items[0]).toMatchObject({ user: { name: 'Ambor' }, actor: resolved })
    expect(resolve).toHaveBeenCalledWith([identity], new Set(['https://id.realmroot.dev']))
  })

  it('formats the API key name as the actor without calling Agent Info', async () => {
    const event = {
      id: 'e2',
      orgId: 'o1',
      orgName: 'Personal',
      userId: 'u1',
      actorType: 'api_key',
      actorRef: 'key-1',
      actorIssuer: null,
      action: 'download_task_created',
      targetType: 'download_task',
      targetId: 'task-1',
      targetName: 'task-1',
      metadata: null,
      createdAt: new Date(0),
      user: { id: 'u1', name: 'Ambor', image: null },
      actor: { name: 'API key · key-1', image: null, resolved: false },
    } satisfies AdminAuditEventWithOrg
    const resolve = vi.fn(async () => new Map())

    const out = await listAuditEvents(
      {
        audit: { listAdminAudit: async () => ({ items: [event], total: 1, page: 1, pageSize: 20 }) },
        auditActorDirectory: {
          findApiKeyNames: async () => new Map([['key-1', 'CME downloader']]),
          findDeviceNames: async () => new Map(),
          listTrustedAgentIssuerOrigins: async () => new Set(),
        },
        agentInfo: { resolve },
      },
      { page: 1, pageSize: 20 },
    )

    expect(out.items[0]).toMatchObject({
      user: { name: 'Ambor' },
      actor: { name: 'API key · CME downloader', image: null, resolved: true },
    })
    expect(resolve).not.toHaveBeenCalled()
  })

  it('formats the registered device name as the actor behind an upload token', async () => {
    const event = {
      id: 'e3',
      orgId: 'o1',
      orgName: 'Personal',
      userId: 'u1',
      actorType: 'device',
      actorRef: 'device-1',
      actorIssuer: null,
      action: 'upload_confirm',
      targetType: 'file',
      targetId: 'f1',
      targetName: 'downloaded.txt',
      metadata: null,
      createdAt: new Date(0),
      user: { id: 'u1', name: 'Ambor', image: null },
      actor: { name: 'Device · device-1', image: null, resolved: false },
    } satisfies AdminAuditEventWithOrg

    const out = await listAuditEvents(
      {
        audit: { listAdminAudit: async () => ({ items: [event], total: 1, page: 1, pageSize: 20 }) },
        auditActorDirectory: {
          findApiKeyNames: async () => new Map(),
          findDeviceNames: async () => new Map([['device-1', 'Office Mac']]),
          listTrustedAgentIssuerOrigins: async () => new Set(),
        },
        agentInfo: { resolve: async () => new Map() },
      },
      { page: 1, pageSize: 20 },
    )

    expect(out.items[0]).toMatchObject({
      user: { name: 'Ambor' },
      actor: { name: 'Device · Office Mac', image: null, resolved: true },
    })
  })
})
