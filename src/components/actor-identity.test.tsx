import type { ActorAttribution } from '@shared/schemas'
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ActorIdentity } from './actor-identity'

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => (key === 'actors.notRecorded' ? 'Not recorded' : key) }),
}))

afterEach(cleanup)

describe('ActorIdentity', () => {
  it('renders the resolved name and avatar', () => {
    const actor: ActorAttribution = {
      type: 'agent',
      ref: 'agent-1',
      issuer: 'https://realm.example.com',
      name: 'Research Agent',
      image: 'https://example.com/agent.png',
      resolved: true,
    }

    render(<ActorIdentity actor={actor} />)

    expect(screen.getByText('Research Agent')).toBeTruthy()
    expect(screen.getByTitle('Research Agent')).toBeTruthy()
  })

  it('uses explicit text for missing historical attribution', () => {
    render(<ActorIdentity actor={null} />)

    expect(screen.getByText('Not recorded')).toBeTruthy()
  })

  it('renders machine identities without inventing user initials', () => {
    render(
      <ActorIdentity
        actor={{
          type: 'device',
          ref: 'device-1',
          issuer: null,
          name: 'Device · downloader',
          image: null,
          resolved: true,
        }}
      />,
    )

    expect(screen.getByText('Device · downloader')).toBeTruthy()
    expect(document.querySelector('svg')).toBeTruthy()
  })
})
