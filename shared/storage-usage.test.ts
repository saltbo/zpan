import { describe, expect, it } from 'vitest'
import { classifyStorageUsage } from './storage-usage'

describe('classifyStorageUsage', () => {
  it.each([
    ['image/jpeg', 'photos'],
    ['video/mp4', 'videos'],
    ['audio/flac', 'music'],
    ['text/plain', 'documents'],
    ['application/pdf', 'documents'],
    ['application/zip', 'archives'],
    ['application/octet-stream', 'other'],
    ['', 'other'],
  ])('classifies %s as %s', (mime, category) => {
    expect(classifyStorageUsage(mime)).toBe(category)
  })
})
