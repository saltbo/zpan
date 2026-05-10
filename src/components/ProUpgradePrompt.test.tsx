import { cleanup, render } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { ProUpgradePrompt } from './ProUpgradePrompt'

afterEach(cleanup)

describe('ProUpgradePrompt', () => {
  it('renders title, description, and action', () => {
    const { getByText } = render(
      <ProUpgradePrompt title="Unlock Audit Logs" description="Audit Logs are a Pro feature." actionLabel="Upgrade" />,
    )

    expect(getByText('Unlock Audit Logs')).toBeTruthy()
    expect(getByText('Audit Logs are a Pro feature.')).toBeTruthy()
    expect(getByText('Upgrade')).toBeTruthy()
  })

  it('links to licensing by default', () => {
    const { getByRole } = render(<ProUpgradePrompt title="Unlock" description="Description" actionLabel="Upgrade" />)

    expect(getByRole('link').getAttribute('href')).toBe('/admin/licensing')
  })

  it('renders with the pro-upgrade-prompt slot attribute', () => {
    const { container } = render(<ProUpgradePrompt title="Unlock" description="Description" actionLabel="Upgrade" />)

    expect(container.querySelector('[data-slot="pro-upgrade-prompt"]')).toBeTruthy()
  })
})
