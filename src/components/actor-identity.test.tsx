import type { ActorAttribution } from '@shared/schemas'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ActorAvatarHoverCard, ActorIdentity } from './actor-identity'

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => (key === 'actors.notRecorded' ? '-' : key) }),
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
      profileUrl: 'https://realm.example.com/agents/agent-1',
      resolved: true,
    }

    render(<ActorIdentity actor={actor} />)

    expect(screen.getByText('Research Agent')).toBeTruthy()
    expect(screen.getByTitle('Research Agent')).toBeTruthy()
  })

  it('uses a dash for missing historical attribution', () => {
    render(<ActorIdentity actor={null} />)

    expect(screen.getByText('-')).toBeTruthy()
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

describe('ActorAvatarHoverCard', () => {
  it('keeps the file-list cell avatar-only and reveals the detailed identity card on hover', async () => {
    const actor: ActorAttribution = {
      type: 'oauth',
      ref: 'agent-1',
      issuer: 'https://realm.example.com',
      name: 'Research Agent',
      image: 'https://example.com/agent.png',
      profileUrl: 'https://realm.example.com/agents/agent-1',
      resolved: true,
    }

    render(<ActorAvatarHoverCard actor={actor} />)

    const trigger = screen.getByLabelText('files.createdBy: Research Agent')
    expect(trigger.textContent).toBe('')
    fireEvent.pointerEnter(trigger)

    await waitFor(() => expect(screen.getByText('Research Agent')).toBeTruthy())
    expect(screen.getByText('actors.type.oauth')).toBeTruthy()
    expect(screen.getByText('agent-1')).toBeTruthy()
    expect(screen.getByText('https://realm.example.com')).toBeTruthy()
    const profileLink = screen.getByRole('link')
    expect(profileLink.getAttribute('href')).toBe('https://realm.example.com/agents/agent-1')
    expect(profileLink.getAttribute('target')).toBe('_blank')
  })

  it('wraps long stable identifiers without hiding the full value', async () => {
    const ref = 'agent-0123456789abcdef0123456789abcdef'
    render(
      <ActorAvatarHoverCard
        actor={{
          type: 'agent',
          ref,
          issuer: null,
          name: 'Research Agent',
          image: null,
          resolved: true,
        }}
      />,
    )

    fireEvent.pointerEnter(screen.getByLabelText('files.createdBy: Research Agent'))

    const visibleRef = await waitFor(() => screen.getByText(ref))
    expect(visibleRef.className).toContain('break-all')
  })

  it('contains long identity fields within the hover card', async () => {
    const name = 'A very long automated actor identity name that must stay inside the card'
    const issuer = `https://${'identity-segment-'.repeat(8)}example.com`
    render(
      <ActorAvatarHoverCard
        actor={{
          type: 'agent',
          ref: 'agent-1',
          issuer,
          name,
          image: null,
          resolved: true,
        }}
      />,
    )

    fireEvent.pointerEnter(screen.getByLabelText(`files.createdBy: ${name}`))

    await waitFor(() => expect(screen.getByText(name)).toBeTruthy())
    const card = document.querySelector('[data-slot="hover-card-content"]')
    expect(card).toBeTruthy()
    expect(card!.className).toContain('overflow-hidden')
    expect(screen.getByText(name).className).toContain('break-words')
    expect(screen.getByText(issuer).className).toContain('break-all')
  })

  it('uses a dash when attribution was not recorded', () => {
    render(<ActorAvatarHoverCard actor={null} />)
    expect(screen.getByText('-')).toBeTruthy()
  })
})
