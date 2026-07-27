export type ResourceChangeScopeType = 'organization' | 'user' | 'system'
export type ResourceChangeType = 'upsert' | 'delete'

export interface ResourceChange {
  sequence: number
  scopeType: ResourceChangeScopeType
  scopeId: string
  resourceType: string
  resourceId: string
  changeType: ResourceChangeType
  action: string | null
  metadata: Record<string, unknown> | null
  occurredAt: Date
}

export interface RecordResourceChangeInput {
  scopeType: ResourceChangeScopeType
  scopeId: string
  resourceType: string
  resourceId: string
  changeType: ResourceChangeType
  action?: string
  metadata?: Record<string, unknown>
  occurredAt: Date
}

export interface ResourceChangeRepo {
  listAfter(input: {
    scopeType: ResourceChangeScopeType
    scopeId: string
    resourceTypes?: string[]
    sequence: number
    limit: number
  }): Promise<ResourceChange[]>
  oldestSequence(input: {
    scopeType: ResourceChangeScopeType
    scopeId: string
    resourceTypes?: string[]
  }): Promise<number | null>
  latestSequence(input: { scopeType: ResourceChangeScopeType; scopeId: string }): Promise<number>
  purgeBefore(cutoff: Date): Promise<number>
}
