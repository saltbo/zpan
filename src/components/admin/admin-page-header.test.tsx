import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { AdminPageHeader } from './admin-page-header'

describe('AdminPageHeader', () => {
  it('renders title, description, badges, actions, and filters in stable regions', () => {
    render(
      <AdminPageHeader
        title="Storages"
        description="Manage backing storage"
        badge={<span>Legacy badge</span>}
        badges={[<span key="pro">Pro</span>, <span key="beta">Beta</span>]}
        actions={<button type="button">Add storage</button>}
        filters={<input aria-label="Search storages" />}
      />,
    )

    expect(screen.getByRole('heading', { level: 2, name: 'Storages' })).toBeTruthy()
    expect(screen.getByText('Manage backing storage')).toBeTruthy()
    expect(screen.getByText('Legacy badge')).toBeTruthy()
    expect(screen.getByText('Pro')).toBeTruthy()
    expect(screen.getByText('Beta')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Add storage' })).toBeTruthy()
    expect(screen.getByLabelText('Search storages')).toBeTruthy()
  })

  it('keeps the previous action prop working', () => {
    render(<AdminPageHeader title="Audit" action={<button type="button">Export</button>} />)

    expect(screen.getByRole('button', { name: 'Export' })).toBeTruthy()
  })
})
