import { expect, test } from '@playwright/test'

// ---------------------------------------------------------------------------
// Pages that need no session carry their own language menu and theme menu,
// because a visitor decides there whether the site is usable for them.
// ---------------------------------------------------------------------------

const PAGES = [
  { name: 'sign-in', path: '/sign-in' },
  { name: 'sign-up', path: '/sign-up' },
  { name: 'forgot password', path: '/forgot-password' },
  { name: 'reset password', path: '/reset-password?token=e2e-token' },
  { name: 'share', path: '/s/e2e-missing-share' },
  { name: 'public profile', path: '/u/e2e-missing-user' },
]

test.describe('Language and theme without a session', () => {
  for (const { name, path } of PAGES) {
    test(`${name} offers language and theme @desktop @mobile @critical [spec: preferences/sessionless-controls]`, async ({
      page,
    }) => {
      await page.goto(path)

      const theme = page.getByRole('button', { name: /^Theme:/ })
      await expect(theme).toBeVisible()
      await theme.click()
      const choices = page.getByRole('menuitemradio')
      await expect(choices).toHaveText(['System', 'Light', 'Dark'])
      await page.getByRole('menuitemradio', { name: 'Dark' }).click()
      await expect(page.locator('html')).toHaveClass(/dark/)

      const language = page.getByRole('button', { name: /^Language:/ })
      await expect(language).toBeVisible()
      await language.click()
      await page.getByRole('menuitemradio', { name: '中文' }).click()
      await expect(page.getByRole('button', { name: '主题: 深色' })).toBeVisible()
      await expect(page.getByRole('button', { name: /^语言: 中文$/ })).toBeVisible()
    })
  }
})
