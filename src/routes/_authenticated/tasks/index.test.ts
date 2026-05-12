import { describe, expect, it } from 'vitest'
import { isActiveJobStatus, statusForTab } from './index'

describe('tasks route filters', () => {
  it('keeps all and active tabs type-generic by not adding a backend type filter', () => {
    expect(statusForTab('all')).toBeUndefined()
    expect(statusForTab('active')).toBeUndefined()
  })

  it('maps completed and failed tabs to backend status filters', () => {
    expect(statusForTab('completed')).toBe('completed')
    expect(statusForTab('failed')).toBe('failed')
  })

  it('treats queued and running jobs as active', () => {
    expect(isActiveJobStatus('queued')).toBe(true)
    expect(isActiveJobStatus('running')).toBe(true)
    expect(isActiveJobStatus('completed')).toBe(false)
    expect(isActiveJobStatus('failed')).toBe(false)
    expect(isActiveJobStatus('canceled')).toBe(false)
  })
})
