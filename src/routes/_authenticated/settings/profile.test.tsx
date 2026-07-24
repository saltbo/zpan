import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { UsernameCard } from './profile'

const session = vi.hoisted(() => ({
  value: {
    user: {
      name: 'Alice',
      email: 'alice@example.com',
      image: null,
      username: 'alice',
    },
  } as { user: { name: string; email: string; image: string | null; username?: string } } | null,
}))

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}))

vi.mock('@tanstack/react-router', () => ({
  createFileRoute: () => (options: unknown) => options,
}))

vi.mock('@/lib/auth-client', () => ({
  authClient: {
    getSession: vi.fn(),
    updateUser: vi.fn(),
    $store: { notify: vi.fn() },
  },
  useSession: () => ({ data: session.value }),
}))

vi.mock('@/lib/api', () => ({
  deleteAvatar: vi.fn(),
  uploadAvatar: vi.fn(),
}))

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
  session.value = {
    user: {
      name: 'Alice',
      email: 'alice@example.com',
      image: null,
      username: 'alice',
    },
  }
})

describe('profile settings public homepage link', () => {
  it('links the signed-in user to their public homepage in a new tab', () => {
    render(<UsernameCard />)

    const link = screen.getByRole('link', { name: 'settings.profile.publicHomepage' })
    expect(link.getAttribute('href')).toBe('/u/alice')
    expect(link.getAttribute('target')).toBe('_blank')
    expect(link.getAttribute('rel')).toBe('noopener noreferrer')
  })

  it('does not render a public homepage link before the user has a username', () => {
    session.value = {
      user: {
        name: 'Alice',
        email: 'alice@example.com',
        image: null,
      },
    }

    render(<UsernameCard />)

    expect(screen.queryByRole('link', { name: 'settings.profile.publicHomepage' })).toBeNull()
  })
})
