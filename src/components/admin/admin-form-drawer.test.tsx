import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Input } from '@/components/ui/input'
import { AdminFormDrawer, AdminFormField, AdminSwitchField } from './admin-form-drawer'

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
    const saveButton = screen.getByRole('button', { name: 'Save' })
    const footer = saveButton.parentElement
    expect(saveButton).toBeTruthy()
    expect(footer?.getAttribute('data-slot')).toBe('sheet-footer')
    expect(footer?.className).toContain('flex-row')
    expect(footer?.className).toContain('justify-end')
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

  it('keeps an existing control id associated with its label and merged descriptions', () => {
    render(
      <AdminFormField id="field-id" label="Bucket" description="Choose a bucket" error="Required">
        <Input id="custom-bucket" aria-describedby="external-help" />
      </AdminFormField>,
    )

    const input = screen.getByLabelText('Bucket')
    expect(input.getAttribute('id')).toBe('custom-bucket')
    expect(input.getAttribute('aria-invalid')).toBe('true')
    expect(input.getAttribute('aria-describedby')).toBe('external-help field-id-description field-id-error')
  })

  it('renders required and help affordances without changing label association', () => {
    render(
      <AdminFormField id="bucket" label="Bucket" required help="Use the exact provider bucket name.">
        <Input />
      </AdminFormField>,
    )

    const input = screen.getByLabelText('Bucket')
    expect(input.getAttribute('aria-required')).toBe('true')
    expect(screen.getByText('*')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Help' })).toBeTruthy()
  })
})

describe('AdminSwitchField', () => {
  it('renders a labeled switch with description in a consistent form row', () => {
    render(<AdminSwitchField id="enabled" label="Enabled" description="Allow this feature" checked />)

    const switchControl = screen.getByRole('switch', { name: 'Enabled' })
    const field = switchControl.parentElement

    expect(switchControl.getAttribute('id')).toBe('enabled')
    expect(switchControl.getAttribute('aria-describedby')).toBe('enabled-description')
    expect(screen.getByText('Allow this feature')).toBeTruthy()
    expect(field?.className).toContain('rounded-md')
    expect(field?.className).toContain('border')
  })

  it('marks a switch field as required when requested', () => {
    render(<AdminSwitchField id="enabled" label="Enabled" required checked />)

    const switchControl = screen.getByRole('switch', { name: 'Enabled' })
    expect(switchControl.getAttribute('aria-required')).toBe('true')
    expect(screen.getByText('*')).toBeTruthy()
  })
})
