// Plain DTO describing the share being announced — decoupled from the (still
// unmigrated) share row type so the usecase stays framework-free.
export interface ShareNotificationShare {
  id: string
  token: string
  kind: 'landing' | 'direct'
  expiresAt: Date | null
}

export interface ShareNotificationRecipient {
  recipientUserId?: string | null
  recipientEmail?: string | null
}

export interface ShareNotificationRepo {
  getUserEmail(userId: string): Promise<string | null>
}
