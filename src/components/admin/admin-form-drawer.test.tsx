import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Input } from '@/components/ui/input'
import { AdminFormDrawer, AdminFormField } from './admin-form-drawer'

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => key,
  }),
}))

afterEach(cleanup)

describe('AdminFormDrawer', () => {
  it('renders a right-side form drawer with selectable width, scroll body, and footer', () => {
    render(
      <AdminFormDrawer
        open
        onOpenChange={() => undefined}
        title="Storage settings"
        description="Configure storage"
        width="extra-wide"
        footer={<button type="submit">Save</button>}
        formProps={{ 'aria-label': 'Storage form' }}
      >
        <div>Drawer body</div>
      </AdminFormDrawer>,
    )

    const dialog = screen.getByRole('dialog')
    expect(dialog.className).toContain('right-0')
    expect(dialog.className).toContain('sm:max-w-3xl')
    expect(screen.getByText('Storage settings')).toBeTruthy()
    expect(screen.getByText('Configure storage')).toBeTruthy()
    expect(screen.getByRole('form', { name: 'Storage form' })).toBeTruthy()
    expect(screen.getByText('Drawer body')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Save' })).toBeTruthy()
  })
})

describe('AdminFormField', () => {
  it('connects label, description, error, and invalid state to a direct control', () => {
    render(
      <AdminFormField id="endpoint" label="Endpoint" description="Use an HTTPS endpoint" error="Required">
        <Input aria-describedby="external-help" />
      </AdminFormField>,
    )

    const input = screen.getByLabelText('Endpoint')
    expect(input.getAttribute('id')).toBe('endpoint')
    expect(input.getAttribute('aria-invalid')).toBe('true')
    expect(input.getAttribute('aria-describedby')).toBe('external-help endpoint-description endpoint-error')
    expect(screen.getByText('Use an HTTPS endpoint')).toBeTruthy()
    expect(screen.getByText('Required')).toBeTruthy()
  })
})
