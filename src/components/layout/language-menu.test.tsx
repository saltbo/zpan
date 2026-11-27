import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { DropdownMenu, DropdownMenuContent, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { LanguageMenuButton, LanguageMenuSub } from './language-menu'

const mocks = vi.hoisted(() => ({
  changeLanguage: vi.fn(),
  resolvedLanguage: 'en',
}))

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => key,
    i18n: { changeLanguage: mocks.changeLanguage, resolvedLanguage: mocks.resolvedLanguage },
  }),
}))

const TRIGGER_NAME = /settings\.appearance\.language/

function openButtonMenu(view: ReturnType<typeof render>) {
  fireEvent.pointerDown(view.getByRole('button', { name: TRIGGER_NAME }), { button: 0, ctrlKey: false })
}

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
  mocks.resolvedLanguage = 'en'
})

describe('LanguageMenuButton', () => {
  it('shows the endonym as the visible label, with the word "language" in the accessible name', () => {
    const view = render(<LanguageMenuButton />)
    const trigger = view.getByRole('button', { name: TRIGGER_NAME })

    // The clutter-free trigger shows only the language's own name.
    expect(trigger.textContent).toBe('English')
    expect(trigger.getAttribute('aria-label')).toBe('settings.appearance.language: English')
  })

  it('shows the endonym of a detected locale variant', () => {
    mocks.resolvedLanguage = 'zh-CN'

    const view = render(<LanguageMenuButton />)

    expect(view.getByRole('button', { name: TRIGGER_NAME }).textContent).toBe('中文')
  })

  it('marks the active language as the checked choice', async () => {
    const view = render(<LanguageMenuButton />)
    openButtonMenu(view)

    expect((await screen.findByRole('menuitemradio', { name: 'English' })).getAttribute('data-state')).toBe('checked')
    expect(screen.getByRole('menuitemradio', { name: '中文' }).getAttribute('data-state')).not.toBe('checked')
  })

  it('switches the language from the menu', async () => {
    const view = render(<LanguageMenuButton />)
    openButtonMenu(view)

    fireEvent.click(await screen.findByRole('menuitemradio', { name: '中文' }))

    expect(mocks.changeLanguage).toHaveBeenCalledWith('zh')
  })
})

describe('LanguageMenuSub', () => {
  it('switches the language from inside an existing dropdown menu', async () => {
    const view = render(
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button type="button">account menu</button>
        </DropdownMenuTrigger>
        <DropdownMenuContent>
          <LanguageMenuSub />
        </DropdownMenuContent>
      </DropdownMenu>,
    )

    fireEvent.pointerDown(view.getByRole('button', { name: 'account menu' }), { button: 0, ctrlKey: false })
    fireEvent.click(await screen.findByText('settings.appearance.language'))
    fireEvent.click(await screen.findByRole('menuitemradio', { name: '中文' }))

    expect(mocks.changeLanguage).toHaveBeenCalledWith('zh')
  })
})
