import { describe, expect, it } from 'vitest'
import { STREAM_RESPONSE_MAX_BYTES, streamResponseRange } from './stream'

describe('streamResponseRange', () => {
  it('answers a whole or open-ended request with at most one response worth', () => {
    expect(streamResponseRange(undefined, 1000)).toEqual({ start: 0, end: 999 })
    expect(streamResponseRange('bytes=10-', 1000)).toEqual({ start: 10, end: 999 })
    const size = STREAM_RESPONSE_MAX_BYTES * 3
    expect(streamResponseRange('bytes=0-', size)).toEqual({ start: 0, end: STREAM_RESPONSE_MAX_BYTES - 1 })
  })

  it('serves closed and suffix ranges, clamped to the file', () => {
    expect(streamResponseRange('bytes=100-199', 1000)).toEqual({ start: 100, end: 199 })
    expect(streamResponseRange('bytes=900-5000', 1000)).toEqual({ start: 900, end: 999 })
    expect(streamResponseRange('bytes=-100', 1000)).toEqual({ start: 900, end: 999 })
  })

  it('refuses ranges the file cannot serve', () => {
    expect(streamResponseRange('bytes=1000-', 1000)).toBeNull()
    expect(streamResponseRange('bytes=200-100', 1000)).toBeNull()
    expect(streamResponseRange('bytes=-', 1000)).toBeNull()
    expect(streamResponseRange('bytes=0-1,5-9', 1000)).toBeNull()
    expect(streamResponseRange('items=0-1', 1000)).toBeNull()
    expect(streamResponseRange(undefined, 0)).toBeNull()
  })
})
