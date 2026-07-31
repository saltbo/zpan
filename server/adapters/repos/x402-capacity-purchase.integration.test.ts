import { eq } from 'drizzle-orm'
import { describe, expect, it } from 'vitest'
import { x402CapacityPurchaseIntents } from '../../db/schema'
import { createTestApp } from '../../test/setup'
import { createX402CapacityPurchaseRepo } from './x402-capacity-purchase'

describe('x402 capacity purchase repo', () => {
  it('scopes client idempotency keys to the workspace', async () => {
    const { db } = await createTestApp()
    const repo = createX402CapacityPurchaseRepo(db)

    const first = await repo.create({
      orgId: 'org-1',
      resourceId: 'resource-1',
      requestHash: 'hash-1',
      idempotencyKey: 'purchase-storage',
    })
    const second = await repo.create({
      orgId: 'org-2',
      resourceId: 'resource-1',
      requestHash: 'hash-2',
      idempotencyKey: 'purchase-storage',
    })

    if (!first || !second) throw new Error('Expected both workspace reservations to succeed')
    expect(first.orgId).toBe('org-1')
    expect(second.orgId).toBe('org-2')
  })

  it('rejects a reused idempotency key within the same workspace', async () => {
    const { db } = await createTestApp()
    const repo = createX402CapacityPurchaseRepo(db)
    await repo.create({
      orgId: 'org-1',
      resourceId: 'resource-1',
      requestHash: 'hash-1',
      idempotencyKey: 'purchase-storage',
    })

    await expect(
      repo.create({
        orgId: 'org-1',
        resourceId: 'resource-2',
        requestHash: 'hash-2',
        idempotencyKey: 'purchase-storage',
      }),
    ).rejects.toThrow()
  })

  it('allows only one active order creator and recovers a stale claim', async () => {
    const { db } = await createTestApp()
    const repo = createX402CapacityPurchaseRepo(db)
    const intent = await repo.create({
      orgId: 'org-1',
      resourceId: 'resource-1',
      requestHash: 'hash-1',
      idempotencyKey: 'purchase-storage',
    })

    if (!intent) throw new Error('Expected purchase reservation to succeed')
    expect(await repo.claimCloudOrder(intent.id, new Date(0))).toBe(true)
    expect(await repo.claimCloudOrder(intent.id, new Date(0))).toBe(false)

    await repo.updateCloudState(intent.id, {
      status: 'ordering',
    })
    expect(await repo.claimCloudOrder(intent.id, new Date(Date.now() + 1000))).toBe(true)
  })

  it('atomically caps pending unpaid intents per workspace', async () => {
    const { db } = await createTestApp()
    const repo = createX402CapacityPurchaseRepo(db)

    const reservations = await Promise.all(
      Array.from({ length: 10 }, (_, i) =>
        repo.create({
          orgId: 'org-1',
          resourceId: `resource-${i}`,
          requestHash: `hash-${i}`,
          idempotencyKey: `purchase-${i}`,
        }),
      ),
    )
    expect(reservations.filter(Boolean)).toHaveLength(5)
    await expect(
      repo.create({
        orgId: 'org-2',
        resourceId: 'resource-other-workspace',
        requestHash: 'hash-other-workspace',
        idempotencyKey: 'purchase-other-workspace',
      }),
    ).resolves.not.toBeNull()
  })

  it('removes abandoned unpaid intents before reserving capacity', async () => {
    const { db } = await createTestApp()
    const repo = createX402CapacityPurchaseRepo(db)
    const abandoned = await repo.create({
      orgId: 'org-1',
      resourceId: 'resource-abandoned',
      requestHash: 'hash-abandoned',
      idempotencyKey: 'purchase-abandoned',
    })
    expect(abandoned).not.toBeNull()
    await db
      .update(x402CapacityPurchaseIntents)
      .set({ updatedAt: new Date(Date.now() - 25 * 60 * 60 * 1000) })
      .where(eq(x402CapacityPurchaseIntents.id, abandoned!.id))

    await expect(
      repo.create({
        orgId: 'org-1',
        resourceId: 'resource-fresh',
        requestHash: 'hash-fresh',
        idempotencyKey: 'purchase-fresh',
      }),
    ).resolves.not.toBeNull()
    await expect(
      db.select().from(x402CapacityPurchaseIntents).where(eq(x402CapacityPurchaseIntents.id, abandoned!.id)),
    ).resolves.toEqual([])
  })

  it('does not count expired quotes against the pending limit', async () => {
    const { db } = await createTestApp()
    const repo = createX402CapacityPurchaseRepo(db)
    for (let i = 0; i < 5; i += 1) {
      const intent = await repo.create({
        orgId: 'org-1',
        resourceId: `expired-resource-${i}`,
        requestHash: `expired-hash-${i}`,
        idempotencyKey: `expired-idempotency-${i}`,
      })
      expect(intent).not.toBeNull()
      await repo.updateCloudState(intent!.id, {
        status: 'quoted',
        expiresAt: new Date(Date.now() - 1000),
      })
    }

    await expect(
      repo.create({
        orgId: 'org-1',
        resourceId: 'resource-after-expiry',
        requestHash: 'hash-after-expiry',
        idempotencyKey: 'purchase-after-expiry',
      }),
    ).resolves.not.toBeNull()
  })

  it('caps total intent creation per workspace within the rolling hour', async () => {
    const { db } = await createTestApp()
    const repo = createX402CapacityPurchaseRepo(db)

    for (let i = 0; i < 20; i += 1) {
      const intent = await repo.create({
        orgId: 'org-1',
        resourceId: `resource-${i}`,
        requestHash: `hash-${i}`,
        idempotencyKey: `purchase-${i}`,
      })
      expect(intent).not.toBeNull()
      await repo.updateCloudState(intent!.id, { status: 'failed' })
    }

    await expect(
      repo.create({
        orgId: 'org-1',
        resourceId: 'resource-hourly-over-limit',
        requestHash: 'hash-hourly-over-limit',
        idempotencyKey: 'purchase-hourly-over-limit',
      }),
    ).resolves.toBeNull()
  })
})
