import { formatError } from './errors'

export async function recordAuditEffect(action: string, write: () => Promise<void>): Promise<void> {
  try {
    await write()
  } catch (error) {
    console.error(`audit.write_failed action=${action} code=${formatError(error)}`)
  }
}
