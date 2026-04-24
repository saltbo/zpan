// Tests for src/components/ProBadge.tsx
import { cleanup, render } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { ProBadge } from './ProBadge'

afterEach(cleanup)

describe('ProBadge', () => {
  it('renders "Pro" text', () => {
    const { getByText } = render(<ProBadge />)
    expect(getByText('Pro')).toBeTruthy()
  })

  it('renders with brand color #1A73E8', () => {
    const { getByText } = render(<ProBadge />)
    const el = getByText('Pro')
    expect(el.style.backgroundColor).toBe('rgb(26, 115, 232)')
  })

  it('has pro-badge slot attribute', () => {
    const { container } = render(<ProBadge />)
    const el = container.querySelector('[data-slot="pro-badge"]')
    expect(el).toBeTruthy()
  })

  it('merges custom className', () => {
    const { container } = render(<ProBadge className="extra-class" />)
    const el = container.querySelector('[data-slot="pro-badge"]')
    expect(el?.className).toContain('extra-class')
  })
})
