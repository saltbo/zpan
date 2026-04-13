import { usernameClient } from 'better-auth/client/plugins'
import { createAuthClient } from 'better-auth/react'

export const authClient = createAuthClient({
  baseURL: import.meta.env.VITE_API_URL || '',
  plugins: [usernameClient()],
})

export const { signIn, signUp, signOut, useSession } = authClient
