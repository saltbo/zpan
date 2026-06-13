import { apiKeyClient } from '@better-auth/api-key/client'
import { deviceAuthorizationClient, organizationClient, usernameClient } from 'better-auth/client/plugins'
import { createAuthClient } from 'better-auth/react'

export const authClient = createAuthClient({
  baseURL: import.meta.env.VITE_API_URL || '',
  plugins: [usernameClient(), organizationClient(), apiKeyClient(), deviceAuthorizationClient()],
})

import { clearSessionCache } from './api'

export const { signIn, signUp, useSession, requestPasswordReset, resetPassword } = authClient

// biome-ignore lint/suspicious/noExplicitAny: generic wrapping requires any
function wrapAuthFunction<T extends (...args: any[]) => any>(fn: T): T {
  return new Proxy(fn, {
    apply(target, thisArg, argArray) {
      clearSessionCache()
      return Reflect.apply(target, thisArg, argArray)
    },
  }) as unknown as T
}

export const signOut = wrapAuthFunction(authClient.signOut)

export const {
  organization: {
    create: createOrganization,
    list: listOrganizations,
    getFullOrganization,
    inviteMember,
    removeMember,
    updateMemberRole,
  },
  useListOrganizations,
  useActiveOrganization,
} = authClient

export const setActive = wrapAuthFunction(authClient.organization.setActive)

type DeviceStatus = 'pending' | 'approved' | 'denied'
type AuthFetchResult<T> = { data?: T | null; error?: { message?: string } | null }

function unwrapAuthFetch<T>(result: AuthFetchResult<T>): T {
  if (result.error) throw new Error(result.error.message ?? 'Auth request failed')
  if (!result.data) throw new Error('Auth request failed')
  return result.data
}

export async function verifyDeviceCode(userCode: string) {
  const result = await authClient.$fetch<{ user_code: string; status: DeviceStatus }>('/device', {
    method: 'GET',
    query: { user_code: userCode },
  })
  return unwrapAuthFetch(result)
}

export async function approveDeviceCode(userCode: string) {
  const result = await authClient.$fetch<{ success: boolean }>('/device/approve', {
    method: 'POST',
    body: { userCode },
  })
  return unwrapAuthFetch(result)
}

export async function denyDeviceCode(userCode: string) {
  const result = await authClient.$fetch<{ success: boolean }>('/device/deny', {
    method: 'POST',
    body: { userCode },
  })
  return unwrapAuthFetch(result)
}
