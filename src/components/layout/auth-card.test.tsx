import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { AuthCard } from './auth-card'

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => key,
    i18n: { changeLanguage: vi.fn(), resolvedLanguage: 'en' },
  }),
}))

vi.mock('next-themes', () => ({
  useTheme: () => ({ theme: 'system', setTheme: vi.fn() }),
}))

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

describe('AuthCard', () => {
  it('renders the branded wordmark, the subtitle and the page body', () => {
    render(
      <AuthCard title="Acme Drive" subtitle="auth.signInSubtitle">
        <p>body</p>
      </AuthCard>,
    )

    const heading = screen.getByRole('heading', { level: 1, name: 'Acme Drive' })
    expect(heading.className).toContain('bg-clip-text')
    expect(screen.getByText('auth.signInSubtitle')).toBeTruthy()
    expect(screen.getByText('body')).toBeTruthy()
  })

  it('puts the language and theme controls in the card corner, language first, anchored logically', () => {
    const { container } = render(
      <AuthCard subtitle="auth.signInSubtitle">
        <p>body</p>
      </AuthCard>,
    )

    const cluster = container.querySelector('.absolute.start-3')
    if (!cluster) {
      throw new Error('the auth card corner cluster is missing')
    }
    // Physical right/left anchors would not flip when the document direction is RTL.
    expect(cluster.className).not.toContain('right-')
    const language = screen.getByRole('button', { name: /^settings\.appearance\.language/ })
    const theme = screen.getByRole('button', { name: /^settings\.appearance\.theme/ })
    expect(cluster.contains(theme)).toBe(true)
    // Reading order: the language control comes first in the pair.
    expect(cluster.compareDocumentPosition(language) & Node.DOCUMENT_POSITION_CONTAINED_BY).toBeTruthy()
    expect(language.compareDocumentPosition(theme) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  })

  it('falls back to the default site name when a page has no branding', () => {
    render(
      <AuthCard subtitle="auth.signInSubtitle">
        <p>body</p>
      </AuthCard>,
    )

    expect(screen.getByRole('heading', { level: 1, name: 'ZPan' })).toBeTruthy()
  })
})
