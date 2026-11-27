import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { DropdownMenu, DropdownMenuContent, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { ThemeMenuButton, ThemeMenuSub } from './theme-menu'

const mocks = vi.hoisted(() => ({
  setTheme: vi.fn(),
  theme: 'system',
}))

vi.mock('next-themes', () => ({
  useTheme: () => ({ setTheme: mocks.setTheme, theme: mocks.theme }),
}))

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key, i18n: { resolvedLanguage: 'en' } }),
}))

const TRIGGER_NAME = /^settings\.appearance\.theme/

function openButtonMenu(view: ReturnType<typeof render>) {
  fireEvent.pointerDown(view.getByRole('button', { name: TRIGGER_NAME }), { button: 0, ctrlKey: false })
}

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
  mocks.theme = 'system'
})

describe('ThemeMenuButton', () => {
  it('announces the active setting in the accessible name, with an icon-only trigger', () => {
    const view = render(<ThemeMenuButton />)

    expect(view.getByRole('button', { name: TRIGGER_NAME }).getAttribute('aria-label')).toBe(
      'settings.appearance.theme: settings.appearance.themeSystem',
    )
  })

  it('announces the setting label of a chosen theme', () => {
    mocks.theme = 'dark'

    const view = render(<ThemeMenuButton />)

    expect(view.getByRole('button', { name: TRIGGER_NAME }).getAttribute('aria-label')).toContain(
      'settings.appearance.themeDark',
    )
  })

  it('marks the active setting as the checked choice', async () => {
    const view = render(<ThemeMenuButton />)
    openButtonMenu(view)

    expect(
      (await screen.findByRole('menuitemradio', { name: 'settings.appearance.themeSystem' })).getAttribute(
        'data-state',
      ),
    ).toBe('checked')
    expect(
      screen.getByRole('menuitemradio', { name: 'settings.appearance.themeDark' }).getAttribute('data-state'),
    ).not.toBe('checked')
  })

  it('switches the theme from the menu', async () => {
    const view = render(<ThemeMenuButton />)
    openButtonMenu(view)

    fireEvent.click(await screen.findByRole('menuitemradio', { name: 'settings.appearance.themeDark' }))

    expect(mocks.setTheme).toHaveBeenCalledWith('dark')
  })
})

describe('ThemeMenuSub', () => {
  it('switches the theme from inside an existing dropdown menu', async () => {
    const view = render(
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button type="button">account menu</button>
        </DropdownMenuTrigger>
        <DropdownMenuContent>
          <ThemeMenuSub />
        </DropdownMenuContent>
      </DropdownMenu>,
    )

    fireEvent.pointerDown(view.getByRole('button', { name: 'account menu' }), { button: 0, ctrlKey: false })
    fireEvent.click(await screen.findByText('settings.appearance.theme'))
    fireEvent.click(await screen.findByRole('menuitemradio', { name: 'settings.appearance.themeDark' }))

    expect(mocks.setTheme).toHaveBeenCalledWith('dark')
  })
})
