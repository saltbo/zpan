import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { DropdownMenu, DropdownMenuContent, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { ThemeMenuButton, ThemeMenuSub } from './theme-menu'

const mocks = vi.hoisted(() => ({
  setTheme: vi.fn(),
  theme: 'system' as string | undefined,
}))

vi.mock('next-themes', () => ({
  useTheme: () => ({ setTheme: mocks.setTheme, theme: mocks.theme }),
}))

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}))

const CHOICES = ['settings.appearance.themeSystem', 'settings.appearance.themeLight', 'settings.appearance.themeDark']

function openButtonMenu(view: ReturnType<typeof render>) {
  fireEvent.pointerDown(view.getByRole('button', { name: /settings\.appearance\.theme/ }), {
    button: 0,
    ctrlKey: false,
  })
}

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
  mocks.theme = 'system'
})

describe('ThemeMenuButton [spec: preferences/theme-choices]', () => {
  it('offers system, light, and dark with the current choice marked', async () => {
    mocks.theme = 'dark'
    const view = render(<ThemeMenuButton />)
    openButtonMenu(view)

    const items = await screen.findAllByRole('menuitemradio')
    expect(items.map((item) => item.textContent)).toEqual(CHOICES)
    expect(
      screen.getByRole('menuitemradio', { name: 'settings.appearance.themeDark' }).getAttribute('data-state'),
    ).toBe('checked')
  })

  it('names the current choice on the button', () => {
    mocks.theme = 'light'
    const view = render(<ThemeMenuButton />)

    expect(view.getByRole('button').getAttribute('aria-label')).toBe(
      'settings.appearance.theme: settings.appearance.themeLight',
    )
  })

  it('treats an unset theme as system', async () => {
    mocks.theme = undefined
    const view = render(<ThemeMenuButton />)
    openButtonMenu(view)

    expect(
      (await screen.findByRole('menuitemradio', { name: 'settings.appearance.themeSystem' })).getAttribute(
        'data-state',
      ),
    ).toBe('checked')
  })

  it('applies the picked theme', async () => {
    const view = render(<ThemeMenuButton />)
    openButtonMenu(view)

    fireEvent.click(await screen.findByRole('menuitemradio', { name: 'settings.appearance.themeLight' }))

    expect(mocks.setTheme).toHaveBeenCalledWith('light')
  })
})

describe('ThemeMenuSub', () => {
  it('offers the same three choices inside a menu', async () => {
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

    const items = await screen.findAllByRole('menuitemradio')
    expect(items.map((item) => item.textContent)).toEqual(CHOICES)
  })
})
