/**
 * Flatten an error and its `cause` chain into a single string.
 *
 * Drizzle wraps the underlying driver error in `DrizzleQueryError`, whose
 * `message` is only `Failed query: <sql>`; the real D1 error lives in `.cause`.
 * Logging just `.message` hides why the query failed — this surfaces the chain.
 */
export function formatError(error: unknown): string {
  if (!(error instanceof Error)) return String(error)

  const parts: string[] = [error.message]
  let cause = (error as { cause?: unknown }).cause
  while (cause instanceof Error) {
    parts.push(cause.message)
    cause = (cause as { cause?: unknown }).cause
  }
  if (cause !== undefined) parts.push(String(cause))

  return parts.join(' <- ')
}
