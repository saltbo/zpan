import type { AdminOverview } from '@shared/types'
import { describe, expect, it } from 'vitest'
import { downloaders, storages } from '../db/schema.js'
import { adminHeaders, createTestApp } from '../test/setup.js'

describe('Admin overview API', () => {
  it('requires authentication', async () => {
    const { app } = await createTestApp()
    const response = await app.request('/api/site/overview')
    expect(response.status).toBe(401)
  })

  it('returns empty live resources when no backend or downloader is registered', async () => {
    const { app } = await createTestApp()
    const response = await app.request('/api/site/overview', { headers: await adminHeaders(app) })
    expect(response.status).toBe(200)
    const body = (await response.json()) as AdminOverview
    expect(body.storages).toMatchObject({ total: 0, used: 0, capacity: 0 })
    expect(body.downloaders).toMatchObject({ total: 0, online: 0, downloadBps: 0, uploadBps: 0 })
  })

  it('returns current storage and registered downloader state without storage credentials', async () => {
    const { app, db } = await createTestApp()
    const now = new Date()
    const headers = await adminHeaders(app)
    await db.insert(storages).values({
      id: 'storage-1',
      provider: 'aws-s3',
      bucket: 'files',
      endpoint: 'https://s3.example.com',
      region: 'auto',
      accessKey: 'access-key',
      secretKey: 'secret-key',
      filePath: '',
      customHost: '',
      capacity: 1000,
      used: 400,
      status: 'active',
      createdAt: now,
      updatedAt: now,
    })
    await db.insert(downloaders).values({
      id: 'downloader-1',
      name: 'edge-1',
      tokenHash: 'token-hash',
      tokenJti: 'token-jti',
      status: 'online',
      enabled: true,
      version: '1.0.0',
      hostname: 'edge-1',
      platform: 'linux',
      arch: 'amd64',
      engine: 'aria2',
      capabilities: '["http"]',
      maxConcurrentTasks: 2,
      currentTasks: 1,
      downloadBps: 100,
      uploadBps: 50,
      freeDiskBytes: 1000,
      createdBy: 'admin-1',
      lastHeartbeatAt: now,
      createdAt: now,
      updatedAt: now,
    })

    const response = await app.request('/api/site/overview', { headers })
    expect(response.status).toBe(200)
    const body = (await response.json()) as AdminOverview
    expect(body.storages).toMatchObject({ total: 1, writable: 1, used: 400, capacity: 1000 })
    expect(body.storages.items[0]).not.toHaveProperty('accessKey')
    expect(body.storages.items[0]).not.toHaveProperty('secretKey')
    expect(body.downloaders).toMatchObject({
      total: 1,
      online: 1,
      activeTasks: 1,
      totalSlots: 2,
      availableSlots: 1,
      downloadBps: 100,
      uploadBps: 50,
    })
    expect(body.downloaders.items[0]).toMatchObject({ name: 'edge-1', status: 'online' })
  })
})
