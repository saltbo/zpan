import { apiKeyClient } from '@better-auth/api-key/client'
import { organizationClient, usernameClient } from 'better-auth/client/plugins'
import { createAuthClient } from 'better-auth/react'

export const authClient = createAuthClient({
  baseURL: import.meta.env.VITE_API_URL || '',
  plugins: [usernameClient(), organizationClient(), apiKeyClient()],
})

export const { signIn, signUp, signOut, useSession } = authClient

export const {
  organization: {
    create: createOrganization,
    list: listOrganizations,
    getFullOrganization,
    setActive,
    inviteMember,
    removeMember,
    updateMemberRole,
  },
  useListOrganizations,
  useActiveOrganization,
} = authClient
