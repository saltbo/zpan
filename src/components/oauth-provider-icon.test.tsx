import { cleanup, render } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { OAuthProviderIcon } from '@/components/oauth-provider-icon'

afterEach(cleanup)

describe('OAuthProviderIcon', () => {
  it('renders a fixed-size simple icon for supported brand icons', () => {
    const { container } = render(<OAuthProviderIcon icon="github" name="GitHub" />)

    const icon = container.querySelector('svg')
    expect(icon).not.toBeNull()
    expect(icon?.getAttribute('viewBox')).toBe('0 0 24 24')
    expect(icon?.getAttribute('aria-hidden')).toBe('true')
    expect(icon?.getAttribute('fill')).toBe('currentColor')
    expect(icon?.classList.contains('size-4')).toBe(true)
    expect(icon?.classList.contains('shrink-0')).toBe(true)
    expect(icon?.querySelector('path')).not.toBeNull()
  })

  it('renders a fixed-size lucide icon for supported non-brand icons', () => {
    const { container } = render(<OAuthProviderIcon icon="microsoft" name="Microsoft" />)

    const icon = container.querySelector('svg')
    expect(icon).not.toBeNull()
    expect(icon?.getAttribute('aria-hidden')).toBe('true')
    expect(icon?.classList.contains('size-4')).toBe(true)
    expect(icon?.classList.contains('shrink-0')).toBe(true)
  })

  it('renders a fixed-size fallback initial for custom providers', () => {
    const { getByText } = render(<OAuthProviderIcon icon="company-sso" name="Company SSO" />)

    const icon = getByText('C')
    expect(icon.getAttribute('aria-hidden')).toBe('true')
    expect(icon.classList.contains('size-4')).toBe(true)
    expect(icon.classList.contains('shrink-0')).toBe(true)
  })
})
