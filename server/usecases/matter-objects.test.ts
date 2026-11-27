import { describe, expect, it, vi } from 'vitest'
import { chargedStorageId, duplicateMatterObject, releaseMatterObject, releaseMatterObjects } from './matter-objects'
import type { S3Gateway, StorageRecord } from './ports'

const storageA = { id: 'a' } as StorageRecord
const storageB = { id: 'b' } as StorageRecord

function fakeS3() {
  return {
    deleteObject: vi.fn(async () => {}),
    deleteObjects: vi.fn(async () => {}),
    copyObject: vi.fn(async () => {}),
    streamCopy: vi.fn(async () => {}),
  } as unknown as S3Gateway &
    Record<'deleteObject' | 'deleteObjects' | 'copyObject' | 'streamCopy', ReturnType<typeof vi.fn>>
}

describe('releaseMatterObjects', () => {
  it('deletes owned objects and leaves torrent objects to eviction', async () => {
    const s3 = fakeS3()
    await releaseMatterObjects(s3, storageA, ['org/u/a.mkv', 'bt/ab/0', ''])
    expect(s3.deleteObjects).toHaveBeenCalledWith(storageA, ['org/u/a.mkv'])

    await releaseMatterObject(s3, storageA, 'bt/ab/1')
    expect(s3.deleteObject).not.toHaveBeenCalled()
    await releaseMatterObject(s3, storageA, 'org/u/b.mkv')
    expect(s3.deleteObject).toHaveBeenCalledWith(storageA, 'org/u/b.mkv')
  })
})

describe('duplicateMatterObject', () => {
  const params = { uid: 'u', orgId: 'org', name: 'movie.mkv' }

  it('writes another reference to a cached object within its storage', async () => {
    const s3 = fakeS3()
    const result = await duplicateMatterObject(s3, {
      ...params,
      sourceStorage: storageA,
      sourceKey: 'bt/ab/0',
      targetStorage: storageA,
    })
    expect(result).toEqual({ key: 'bt/ab/0', chargedStorageId: null })
    expect(s3.copyObject).not.toHaveBeenCalled()
  })

  it('gives a copy of a cached object into another storage its own bytes', async () => {
    const s3 = fakeS3()
    const result = await duplicateMatterObject(s3, {
      ...params,
      sourceStorage: storageA,
      sourceKey: 'bt/ab/0',
      targetStorage: storageB,
    })
    expect(s3.streamCopy).toHaveBeenCalledWith(storageA, 'bt/ab/0', storageB, result.key)
    expect(result.key.startsWith('bt/')).toBe(false)
    expect(result.chargedStorageId).toBe('b')
  })

  it('copies owned objects within a storage and streams them across storages', async () => {
    const s3 = fakeS3()
    const same = await duplicateMatterObject(s3, {
      ...params,
      sourceStorage: storageA,
      sourceKey: 'org/u/a.mkv',
      targetStorage: storageA,
    })
    expect(same.chargedStorageId).toBe('a')
    expect(s3.copyObject).toHaveBeenCalledWith(storageA, 'org/u/a.mkv', storageA, same.key)

    const across = await duplicateMatterObject(s3, {
      ...params,
      sourceStorage: storageA,
      sourceKey: 'org/u/a.mkv',
      targetStorage: storageB,
    })
    expect(across.chargedStorageId).toBe('b')
    expect(s3.streamCopy).toHaveBeenCalledWith(storageA, 'org/u/a.mkv', storageB, across.key)
  })
})

describe('charging', () => {
  it('charges copies of referencing files to no storage', () => {
    expect(chargedStorageId({ object: 'bt/ab/0', storageId: 'a' })).toBeNull()
    expect(chargedStorageId({ object: 'org/u/a.mkv', storageId: 'a' })).toBe('a')
  })
})
