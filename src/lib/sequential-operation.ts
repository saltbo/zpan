export interface SequentialOperationFailure<T> {
  item: T
  error: Error
}

export interface SequentialOperationResult<T> {
  completed: number
  failed: SequentialOperationFailure<T>[]
  cancelled: boolean
}

interface SequentialOperationOptions<T> {
  items: T[]
  runItem: (item: T, index: number) => Promise<unknown>
  shouldCancel?: () => boolean
  onItemStart?: (item: T, index: number) => void
  onItemComplete?: (item: T, index: number) => void
  onItemFailure?: (item: T, error: Error, index: number) => void
}

export async function runSequentialOperation<T>({
  items,
  runItem,
  shouldCancel = () => false,
  onItemStart,
  onItemComplete,
  onItemFailure,
}: SequentialOperationOptions<T>): Promise<SequentialOperationResult<T>> {
  let completed = 0
  const failed: SequentialOperationFailure<T>[] = []

  for (let index = 0; index < items.length; index += 1) {
    if (shouldCancel()) return { completed, failed, cancelled: true }

    const item = items[index]
    onItemStart?.(item, index)
    try {
      await runItem(item, index)
      completed += 1
      onItemComplete?.(item, index)
    } catch (error) {
      const normalized = error instanceof Error ? error : new Error(String(error))
      failed.push({ item, error: normalized })
      onItemFailure?.(item, normalized, index)
    }
  }

  return { completed, failed, cancelled: false }
}
