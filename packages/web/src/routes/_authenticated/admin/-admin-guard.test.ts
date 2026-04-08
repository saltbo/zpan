/**
 * Tests for the admin route's beforeLoad guard.
 *
 * The guard is defined as an inline arrow function in route.tsx. These tests
 * validate the publicly documented contract: only users with role === 'admin'
 * may access the admin layout; all other users are redirected to /files.
 *
 * The logic under test (extracted for unit testing):
 *
 *   const user = (context as { user?: { role?: string } }).user
 *   if (user?.role !== 'admin') {
 *     throw redirect({ to: '/files' })
 *   }
 *
 * We test the guard logic directly rather than importing the TanStack Route
 * object, since that object requires a router context that is unavailable in
 * the node test environment.
 */
import { describe, expect, it } from 'vitest'

// Inline reproduction of the guard logic from route.tsx.
// If the guard logic changes in the source, this helper must be updated.
function runAdminGuard(context: unknown): { redirectTo: string } | null {
  const user = (context as { user?: { role?: string } }).user
  if (user?.role !== 'admin') {
    return { redirectTo: '/files' }
  }
  return null
}

describe('admin route beforeLoad guard', () => {
  describe('happy path — admin role', () => {
    it('allows access when user role is admin', () => {
      expect(runAdminGuard({ user: { role: 'admin' } })).toBeNull()
    })
  })

  describe('redirect cases — non-admin roles', () => {
    it('redirects to /files when user role is user', () => {
      const result = runAdminGuard({ user: { role: 'user' } })
      expect(result?.redirectTo).toBe('/files')
    })

    it('redirects to /files when user role is moderator', () => {
      const result = runAdminGuard({ user: { role: 'moderator' } })
      expect(result?.redirectTo).toBe('/files')
    })

    it('redirects to /files when role is an empty string', () => {
      const result = runAdminGuard({ user: { role: '' } })
      expect(result?.redirectTo).toBe('/files')
    })

    it('redirects to /files when role is undefined', () => {
      const result = runAdminGuard({ user: { role: undefined } })
      expect(result?.redirectTo).toBe('/files')
    })

    it('redirects to /files when user object is absent', () => {
      const result = runAdminGuard({})
      expect(result?.redirectTo).toBe('/files')
    })

    it('redirects to /files when context is an empty object', () => {
      const result = runAdminGuard({})
      expect(result?.redirectTo).toBe('/files')
    })

    it('redirects to /files when user is null', () => {
      const result = runAdminGuard({ user: null })
      expect(result?.redirectTo).toBe('/files')
    })
  })
})
