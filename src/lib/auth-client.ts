import { apiKeyClient } from '@better-auth/api-key/client'
import { adminClient, deviceAuthorizationClient, organizationClient, usernameClient } from 'better-auth/client/plugins'
import { createAuthClient } from 'better-auth/react'

export const authClient = createAuthClient({
  baseURL: import.meta.env.VITE_API_URL || '',
  plugins: [usernameClient(), organizationClient(), adminClient(), apiKeyClient(), deviceAuthorizationClient()],
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

// ── Admin user management (better-auth admin plugin) ─────────────────────────
// These wrap better-auth's /api/auth/admin/* endpoints and normalize the
// {data,error} client result into a plain shape, so the admin UI never touches
// the raw better-auth user record. Storage quota (not known to better-auth) is
// fetched separately via getUserQuotas() in lib/api.ts.

export type AdminUser = {
  id: string
  name: string
  email: string
  username: string
  image: string | null
  role: string | null
  banned: boolean
  createdAt: number
}

type BetterAuthUser = {
  id: string
  name: string
  email: string
  image?: string | null
  role?: string | null
  banned?: boolean | null
  username?: string | null
  createdAt: Date | string | number
}

function toAdminUser(u: BetterAuthUser): AdminUser {
  return {
    id: u.id,
    name: u.name ?? '',
    email: u.email ?? '',
    username: u.username ?? '',
    image: u.image ?? null,
    role: u.role ?? null,
    banned: Boolean(u.banned),
    createdAt: new Date(u.createdAt).getTime(),
  }
}

export async function adminListUsers(params: {
  limit: number
  offset: number
  search?: string
}): Promise<{ users: AdminUser[]; total: number }> {
  const query: Record<string, unknown> = {
    limit: params.limit,
    offset: params.offset,
    sortBy: 'createdAt',
    sortDirection: 'desc',
  }
  if (params.search?.trim()) {
    query.searchField = 'email'
    query.searchOperator = 'contains'
    query.searchValue = params.search.trim()
  }
  // biome-ignore lint/suspicious/noExplicitAny: better-auth's inferred query type is narrower than this dynamic shape
  const data = unwrapAuthFetch(await authClient.admin.listUsers({ query: query as any }))
  return { users: (data.users as BetterAuthUser[]).map(toAdminUser), total: data.total }
}

export async function adminGetUser(userId: string): Promise<AdminUser> {
  // better-auth's get-user returns the user object directly (the {user} wrapper
  // in its OpenAPI annotation is inaccurate; the runtime body is the bare user).
  const data = unwrapAuthFetch(await authClient.admin.getUser({ query: { id: userId } }))
  return toAdminUser(data as BetterAuthUser)
}

export async function adminSetUserBanned(userId: string, banned: boolean): Promise<void> {
  unwrapAuthFetch(banned ? await authClient.admin.banUser({ userId }) : await authClient.admin.unbanUser({ userId }))
}

export async function adminRemoveUser(userId: string): Promise<void> {
  unwrapAuthFetch(await authClient.admin.removeUser({ userId }))
}
