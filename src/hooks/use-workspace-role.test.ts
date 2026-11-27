import { renderHook } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { useActiveOrganization, useSession } from '@/lib/auth-client'
import { useWorkspaceRoleAtLeast } from './use-workspace-role'

vi.mock('@/lib/auth-client', () => ({ useSession: vi.fn(), useActiveOrganization: vi.fn() }))

function signedIn(role: string | null) {
  vi.mocked(useSession).mockReturnValue({ data: { user: { id: 'u1' } } } as unknown as ReturnType<typeof useSession>)
  vi.mocked(useActiveOrganization).mockReturnValue({
    data: role
      ? {
          id: 'org',
          members: [
            { userId: 'u2', role: 'owner' },
            { userId: 'u1', role },
          ],
        }
      : undefined,
  } as unknown as ReturnType<typeof useActiveOrganization>)
}

afterEach(() => {
  vi.clearAllMocks()
})

describe('useWorkspaceRoleAtLeast', () => {
  it('reads the signed-in user’s role in the active workspace', () => {
    signedIn('editor')
    expect(renderHook(() => useWorkspaceRoleAtLeast('editor')).result.current).toBe(true)
    signedIn('viewer')
    expect(renderHook(() => useWorkspaceRoleAtLeast('editor')).result.current).toBe(false)
  })

  it('denies until the workspace has loaded', () => {
    signedIn(null)
    expect(renderHook(() => useWorkspaceRoleAtLeast('viewer')).result.current).toBe(false)
  })
})
