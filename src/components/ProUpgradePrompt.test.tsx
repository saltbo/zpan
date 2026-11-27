// Tests for src/components/ProUpgradePrompt.tsx
import { cleanup, render } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { ProUpgradePrompt } from './ProUpgradePrompt'

afterEach(cleanup)

const action = { label: 'Upgrade', href: '/admin/licensing' }

describe('ProUpgradePrompt', () => {
  it('renders title, description, and action', () => {
    const { getByText } = render(
      <ProUpgradePrompt title="Unlock Audit Logs" description="Audit Logs are a Pro feature." action={action} />,
    )
    expect(getByText('Unlock Audit Logs')).toBeTruthy()
    expect(getByText('Audit Logs are a Pro feature.')).toBeTruthy()
    expect(getByText('Upgrade')).toBeTruthy()
  })

  it('links the action to its href', () => {
    const { getByRole } = render(<ProUpgradePrompt title="Unlock" description="Description" action={action} />)
    expect(getByRole('link').getAttribute('href')).toBe('/admin/licensing')
  })

  it('shows the note and no link when there is no action', () => {
    const { getByText, queryByRole } = render(
      <ProUpgradePrompt title="Unlock" description="Description" note="Ask your administrator" />,
    )
    expect(getByText('Ask your administrator')).toBeTruthy()
    expect(queryByRole('link')).toBeNull()
  })

  it('uses the theme primary for the action, not a hard-coded color', () => {
    const { getByRole } = render(<ProUpgradePrompt title="Unlock" description="Description" action={action} />)
    const link = getByRole('link')
    expect(link.getAttribute('style')).toBeNull()
    expect(link.className).toContain('bg-primary')
    expect(link.className).toContain('text-primary-foreground')
  })

  it('renders with the pro-upgrade-prompt slot attribute', () => {
    const { container } = render(<ProUpgradePrompt title="Unlock" description="Description" action={action} />)
    expect(container.querySelector('[data-slot="pro-upgrade-prompt"]')).toBeTruthy()
  })
})
