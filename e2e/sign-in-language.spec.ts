import { expect, test } from '@playwright/test'
import { ADMIN_EMAIL, ADMIN_PASSWORD, expandSignInForm } from './helpers'

// ---------------------------------------------------------------------------
// The sign-in page carries the same language menu as the account menu, so a
// visitor can choose a language before authenticating. The language detector
// caches the choice in localStorage, so it survives the sign-in redirect.
// ---------------------------------------------------------------------------

test.describe('Sign-in language menu', () => {
  test('the language button switches the page and persists through sign-in @all @desktop @critical', async ({
    page,
  }) => {
    await page.goto('/sign-in')

    const trigger = page.getByRole('button', { name: /language|语言/i })
    await expect(trigger).toBeVisible()
    await expect(trigger).toContainText('English')

    await trigger.click()
    await page.getByRole('menuitemradio', { name: '中文' }).click()

    // The page re-renders in Chinese immediately, and the button shows the choice.
    await expandSignInForm(page)
    await expect(page.getByLabel('邮箱或用户名')).toBeVisible()
    await expect(trigger).toContainText('中文')

    // The choice survives the sign-in redirect.
    await page.locator('#identity').fill(ADMIN_EMAIL)
    await page.locator('#password').fill(ADMIN_PASSWORD)
    const responsePromise = page.waitForResponse((response) => response.url().includes('/api/auth/sign-in'))
    await page.getByRole('button', { name: /登录/i }).click()
    expect((await responsePromise).status()).toBe(200)
    await expect(page).toHaveURL(/files/, { timeout: 10_000 })

    await expect(page.getByRole('link', { name: '我的文件' })).toBeVisible()
    expect(await page.evaluate(() => localStorage.getItem('i18nextLng'))).toBe('zh')
  })
})
