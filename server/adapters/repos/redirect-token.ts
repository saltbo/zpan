import { generateToken } from '@shared/ids'

const MAX_TOKEN_COLLISION_RETRIES = 5

export async function withRedirectToken<T>(
  length: number,
  operation: (token: string) => Promise<T>,
  isTaken: (token: string) => Promise<boolean>,
  tokenGenerator: (length: number) => string = generateToken,
): Promise<T> {
  for (let attempt = 0; attempt < MAX_TOKEN_COLLISION_RETRIES; attempt += 1) {
    const token = tokenGenerator(length)
    if (await isTaken(token)) continue
    try {
      return await operation(token)
    } catch (error) {
      // Database drivers do not expose a portable SQLite constraint code. Query
      // the shared namespace after a failed transaction and retry only when the
      // candidate is demonstrably occupied; unrelated failures retain identity.
      if (!(await isTaken(token))) throw error
    }
  }
  throw new Error('redirect_token_collision_budget_exhausted')
}
