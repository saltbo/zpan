import { afterEach, describe, expect, it, vi } from 'vitest'
import { recordAuditEffect } from './audit'

describe('recordAuditEffect', () => {
  afterEach(() => vi.restoreAllMocks())

  it('records the event without logging when the write succeeds', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {})
    const write = vi.fn(async () => {})

    await recordAuditEffect('object_update', write)

    expect(write).toHaveBeenCalledOnce()
    expect(error).not.toHaveBeenCalled()
  })

  it('logs a failed audit write without changing the completed business response', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {})

    await expect(
      recordAuditEffect('object_download', async () => {
        throw new Error('database unavailable')
      }),
    ).resolves.toBeUndefined()
    expect(error).toHaveBeenCalledWith('audit.write_failed action=object_download code=database unavailable')
  })
})
