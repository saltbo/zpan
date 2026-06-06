import { describe, expect, it, vi } from 'vitest'
import { runSequentialOperation } from './sequential-operation'

describe('runSequentialOperation', () => {
  it('runs items sequentially and reports completed count', async () => {
    const order: number[] = []

    const result = await runSequentialOperation({
      items: [1, 2, 3],
      runItem: async (item) => {
        order.push(item)
      },
    })

    expect(order).toEqual([1, 2, 3])
    expect(result).toEqual({ completed: 3, failed: [], cancelled: false })
  })

  it('collects failures and continues with remaining items', async () => {
    const result = await runSequentialOperation({
      items: ['a', 'b', 'c'],
      runItem: async (item) => {
        if (item === 'b') throw new Error('boom')
      },
    })

    expect(result.completed).toBe(2)
    expect(result.cancelled).toBe(false)
    expect(result.failed).toHaveLength(1)
    expect(result.failed[0].item).toBe('b')
    expect(result.failed[0].error.message).toBe('boom')
  })

  it('stops before the next item when cancellation is requested', async () => {
    let cancel = false
    const runItem = vi.fn(async (item: number) => {
      if (item === 1) cancel = true
    })

    const result = await runSequentialOperation({
      items: [1, 2, 3],
      shouldCancel: () => cancel,
      runItem,
    })

    expect(runItem).toHaveBeenCalledTimes(1)
    expect(result).toEqual({ completed: 1, failed: [], cancelled: true })
  })
})
