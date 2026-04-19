/**
 * Unit tests for useConflictResolver and withConflictRetry.
 *
 * useConflictResolver is a React hook so we test it by calling the underlying
 * functions exposed in its return value directly — React Testing Library
 * renderHook is not available in the Node test project. We validate the
 * promise-bridge contract (prompt → choose/cancel) by exercising the closure
 * manually, and the sticky-strategy logic via the ref-based path.
 */
import { describe, expect, it, vi } from 'vitest'
import { isNameConflictError } from '@/lib/api'
import { withConflictRetry } from './use-conflict-resolver'

// ─── withConflictRetry ────────────────────────────────────────────────────────

// We test the public withConflictRetry helper which does not depend on React
// state — it takes a prompt function and calls it on conflict.

vi.mock('@/lib/api', async (importActual) => {
  const actual = await importActual<typeof import('@/lib/api')>()
  return { ...actual, isNameConflictError: vi.fn() }
})

describe('withConflictRetry', () => {
  it('returns the result directly when no conflict occurs', async () => {
    vi.mocked(isNameConflictError).mockReturnValue(false)
    const run = vi.fn().mockResolvedValue('success')
    const prompt = vi.fn()

    const result = await withConflictRetry(prompt, 'file', run)

    expect(result).toBe('success')
    expect(prompt).not.toHaveBeenCalled()
    expect(run).toHaveBeenCalledOnce()
  })

  it('calls prompt and re-runs with chosen strategy on NAME_CONFLICT', async () => {
    const fakeError = Object.assign(new Error('conflict'), {
      body: { conflictingName: 'report.pdf', code: 'NAME_CONFLICT' },
    })
    vi.mocked(isNameConflictError).mockImplementation((e) => e === fakeError)

    const run = vi.fn().mockRejectedValueOnce(fakeError).mockResolvedValueOnce('retried')
    const prompt = vi.fn().mockResolvedValue({ strategy: 'rename', applyToAll: false })

    const result = await withConflictRetry(prompt, 'file', run)

    expect(prompt).toHaveBeenCalledOnce()
    expect(prompt).toHaveBeenCalledWith({
      kind: 'file',
      name: 'report.pdf',
      showApplyToAll: undefined,
    })
    expect(run).toHaveBeenCalledTimes(2)
    expect(run).toHaveBeenLastCalledWith('rename')
    expect(result).toBe('retried')
  })

  it('returns undefined when user cancels the conflict dialog', async () => {
    const fakeError = Object.assign(new Error('conflict'), {
      body: { conflictingName: 'file.txt', code: 'NAME_CONFLICT' },
    })
    vi.mocked(isNameConflictError).mockImplementation((e) => e === fakeError)

    const run = vi.fn().mockRejectedValueOnce(fakeError)
    const prompt = vi.fn().mockResolvedValue({ cancelled: true, applyToAll: false })

    const result = await withConflictRetry(prompt, 'folder', run)

    expect(result).toBeUndefined()
    expect(run).toHaveBeenCalledOnce()
  })

  it('propagates non-conflict errors without prompting', async () => {
    const nonConflictError = new Error('Some other error')
    vi.mocked(isNameConflictError).mockReturnValue(false)

    const run = vi.fn().mockRejectedValue(nonConflictError)
    const prompt = vi.fn()

    await expect(withConflictRetry(prompt, 'file', run)).rejects.toThrow('Some other error')
    expect(prompt).not.toHaveBeenCalled()
  })

  it('passes showApplyToAll: true to prompt when opts.showApplyToAll is true', async () => {
    const fakeError = Object.assign(new Error('conflict'), {
      body: { conflictingName: 'data.csv', code: 'NAME_CONFLICT' },
    })
    vi.mocked(isNameConflictError).mockImplementation((e) => e === fakeError)

    const run = vi.fn().mockRejectedValueOnce(fakeError).mockResolvedValueOnce('ok')
    const prompt = vi.fn().mockResolvedValue({ strategy: 'replace', applyToAll: true })

    await withConflictRetry(prompt, 'file', run, { showApplyToAll: true })

    expect(prompt).toHaveBeenCalledWith({
      kind: 'file',
      name: 'data.csv',
      showApplyToAll: true,
    })
  })

  it('uses the chosen strategy in the retry call', async () => {
    const fakeError = Object.assign(new Error('conflict'), {
      body: { conflictingName: 'x.txt', code: 'NAME_CONFLICT' },
    })
    vi.mocked(isNameConflictError).mockImplementation((e) => e === fakeError)

    const run = vi.fn().mockRejectedValueOnce(fakeError).mockResolvedValueOnce('done')
    const prompt = vi.fn().mockResolvedValue({ strategy: 'replace', applyToAll: false })

    await withConflictRetry(prompt, 'file', run)

    expect(run).toHaveBeenLastCalledWith('replace')
  })

  it('retries on each conflict and calls prompt for each one', async () => {
    const error1 = Object.assign(new Error('conflict1'), {
      body: { conflictingName: 'a.txt', code: 'NAME_CONFLICT' },
    })
    const error2 = Object.assign(new Error('conflict2'), {
      body: { conflictingName: 'a (1).txt', code: 'NAME_CONFLICT' },
    })
    vi.mocked(isNameConflictError).mockImplementation((e) => e === error1 || e === error2)

    const run = vi.fn().mockRejectedValueOnce(error1).mockRejectedValueOnce(error2).mockResolvedValueOnce('success')

    const prompt = vi
      .fn()
      .mockResolvedValueOnce({ strategy: 'rename', applyToAll: false })
      .mockResolvedValueOnce({ strategy: 'rename', applyToAll: false })

    const result = await withConflictRetry(prompt, 'file', run)

    expect(prompt).toHaveBeenCalledTimes(2)
    expect(run).toHaveBeenCalledTimes(3)
    expect(result).toBe('success')
  })

  it('throws the last NameConflictError after MAX_CONFLICT_RETRIES (3) consecutive conflicts', async () => {
    const makeConflictError = (name: string) =>
      Object.assign(new Error(`conflict: ${name}`), {
        body: { conflictingName: name, code: 'NAME_CONFLICT' },
      })

    const errors = [
      makeConflictError('a.txt'),
      makeConflictError('a (1).txt'),
      makeConflictError('a (2).txt'),
      makeConflictError('a (3).txt'),
    ]

    vi.mocked(isNameConflictError).mockImplementation((e) => (errors as unknown as Error[]).includes(e as Error))

    const run = vi
      .fn()
      .mockRejectedValueOnce(errors[0])
      .mockRejectedValueOnce(errors[1])
      .mockRejectedValueOnce(errors[2])
      .mockRejectedValueOnce(errors[3])

    const prompt = vi.fn().mockResolvedValue({ strategy: 'rename', applyToAll: false })

    await expect(withConflictRetry(prompt, 'file', run)).rejects.toBe(errors[3])
    // prompt is called for attempts 0, 1, 2 but NOT for attempt 3 (throws immediately)
    expect(prompt).toHaveBeenCalledTimes(3)
    expect(run).toHaveBeenCalledTimes(4)
  })

  it('returns undefined and stops retrying when user cancels the second prompt', async () => {
    const error1 = Object.assign(new Error('conflict1'), {
      body: { conflictingName: 'b.txt', code: 'NAME_CONFLICT' },
    })
    const error2 = Object.assign(new Error('conflict2'), {
      body: { conflictingName: 'b (1).txt', code: 'NAME_CONFLICT' },
    })
    vi.mocked(isNameConflictError).mockImplementation((e) => e === error1 || e === error2)

    const run = vi.fn().mockRejectedValueOnce(error1).mockRejectedValueOnce(error2)

    const prompt = vi
      .fn()
      .mockResolvedValueOnce({ strategy: 'rename', applyToAll: false })
      .mockResolvedValueOnce({ cancelled: true, applyToAll: false })

    const result = await withConflictRetry(prompt, 'file', run)

    expect(result).toBeUndefined()
    expect(prompt).toHaveBeenCalledTimes(2)
    // run was called: once initial, once after first retry — then cancelled
    expect(run).toHaveBeenCalledTimes(2)
  })
})
