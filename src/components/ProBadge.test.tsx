// Tests for src/components/ProBadge.tsx
import { cleanup, render } from '@testing-library/react'
import { afterEach, beforeAll, describe, expect, it } from 'vitest'
import i18n, { i18nReady } from '@/i18n'
import { ProBadge } from './ProBadge'

beforeAll(async () => {
  await i18nReady
  await i18n.changeLanguage('en')
})

afterEach(cleanup)

describe('ProBadge', () => {
  it('renders "Pro" text', () => {
    const { getByText } = render(<ProBadge />)
    expect(getByText('Pro')).toBeTruthy()
  })

  it('uses the primary theme token for its colors', () => {
    const { getByText } = render(<ProBadge />)
    const el = getByText('Pro')
    expect(el.className).toContain('bg-primary')
    expect(el.className).toContain('text-primary-foreground')
    expect(el.style.backgroundColor).toBe('')
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
