// Pure share access rules. No I/O, no frameworks.

export function isAccessibleByUser(recipients: Array<{ recipientUserId: string | null }>, userId: string): boolean {
  return recipients.some((r) => r.recipientUserId === userId)
}
