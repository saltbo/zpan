import type { Deps } from './deps'
import type { ResourceChange, ResourceChangeScopeType } from './ports'

const POLL_INTERVAL_MS = 2000
const HEARTBEAT_INTERVAL_MS = 25_000
const CHANGE_BATCH_SIZE = 100

export type EventsMessage = { event: string; data: unknown; id?: number }
export type EventsEmit = (message: EventsMessage) => void

type ChangeFeed = {
  scopeType: ResourceChangeScopeType
  scopeId: string
  resourceTypes?: string[]
}

export type EventsParams = {
  scope: 'user' | 'download-tasks-only'
  orgId: string | null
  userId: string | null
  afterSequence?: number
  pollIntervalMs?: number
  heartbeatIntervalMs?: number
}

const delay = (ms: number, signal: AbortSignal): Promise<void> =>
  new Promise((resolve) => {
    if (signal.aborted) return resolve()
    const timer = setTimeout(onDone, ms)
    const onAbort = () => {
      clearTimeout(timer)
      onDone()
    }
    function onDone() {
      signal.removeEventListener('abort', onAbort)
      resolve()
    }
    signal.addEventListener('abort', onAbort)
  })

function feedsFor(params: EventsParams): ChangeFeed[] {
  const feeds: ChangeFeed[] = []
  if (params.orgId) {
    feeds.push({
      scopeType: 'organization',
      scopeId: params.orgId,
      resourceTypes: params.scope === 'download-tasks-only' ? ['download_task'] : undefined,
    })
  }
  if (params.scope === 'user' && params.userId) {
    feeds.push({ scopeType: 'user', scopeId: params.userId })
  }
  return feeds
}

function wireChange(change: ResourceChange) {
  return {
    sequence: change.sequence,
    scopeType: change.scopeType,
    resourceType: change.resourceType,
    resourceId: change.resourceId,
    changeType: change.changeType,
    action: change.action,
    metadata: change.metadata,
    occurredAt: change.occurredAt.toISOString(),
  }
}

async function latestSequence(deps: Deps, feeds: ChangeFeed[]): Promise<number> {
  const values = await Promise.all(
    feeds.map((feed) => deps.resourceChanges.latestSequence({ scopeType: feed.scopeType, scopeId: feed.scopeId })),
  )
  return Math.max(0, ...values)
}

async function readChanges(deps: Deps, feeds: ChangeFeed[], sequence: number): Promise<ResourceChange[]> {
  const pages = await Promise.all(
    feeds.map((feed) =>
      deps.resourceChanges.listAfter({
        ...feed,
        sequence,
        limit: CHANGE_BATCH_SIZE,
      }),
    ),
  )
  return pages
    .flat()
    .sort((left, right) => left.sequence - right.sequence)
    .slice(0, CHANGE_BATCH_SIZE)
}

async function retentionGap(deps: Deps, feeds: ChangeFeed[], sequence: number): Promise<boolean> {
  if (sequence === 0) return false
  const oldest = await Promise.all(feeds.map((feed) => deps.resourceChanges.oldestSequence(feed)))
  return oldest.some((value) => value !== null && sequence < value - 1)
}

export async function streamEvents(
  deps: Deps,
  params: EventsParams,
  signal: AbortSignal,
  emit: EventsEmit,
): Promise<void> {
  const feeds = feedsFor(params)
  const pollIntervalMs = params.pollIntervalMs ?? POLL_INTERVAL_MS
  const heartbeatIntervalMs = params.heartbeatIntervalMs ?? HEARTBEAT_INTERVAL_MS
  let sequence = params.afterSequence ?? (await latestSequence(deps, feeds))
  let lastEmitAt = Date.now()

  const send: EventsEmit = (message) => {
    emit(message)
    lastEmitAt = Date.now()
  }

  if (params.afterSequence !== undefined && (await retentionGap(deps, feeds, sequence))) {
    sequence = await latestSequence(deps, feeds)
    send({ event: 'resync', data: { sequence }, id: sequence })
  }

  while (!signal.aborted) {
    try {
      let changed = false
      const changes = await readChanges(deps, feeds, sequence)
      for (const change of changes) {
        sequence = change.sequence
        send({ event: 'resource-change', data: wireChange(change), id: change.sequence })
        changed = true
      }

      if (!changed && Date.now() - lastEmitAt >= heartbeatIntervalMs) {
        send({ event: 'heartbeat', data: { at: new Date().toISOString(), sequence }, id: sequence })
      }
    } catch (error) {
      send({ event: 'error', data: { message: error instanceof Error ? error.message : 'unknown error' } })
    }

    if (!signal.aborted) await delay(pollIntervalMs, signal)
  }
}
