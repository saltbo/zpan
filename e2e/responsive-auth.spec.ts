import { expect, test } from '@playwright/test'

// ---------------------------------------------------------------------------
// Auth pages: sign-in and sign-up should not overflow on any device
// ---------------------------------------------------------------------------
test.describe('Auth pages responsive layout', () => {
  for (const device of ['desktop', 'tablet', 'mobile']) {
    test(`${device}: sign-in page has no horizontal overflow`, async ({ page }, testInfo) => {
      test.skip(testInfo.project.name !== device, `${device} only`)
      await page.goto('/sign-in')
      await expect(page.getByRole('heading', { name: 'ZPan' })).toBeVisible()

      const hasHScroll = await page.evaluate(
        () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
      )
      expect(hasHScroll).toBe(false)
    })

    test(`${device}: sign-up page has no horizontal overflow`, async ({ page }, testInfo) => {
      test.skip(testInfo.project.name !== device, `${device} only`)
      await page.goto('/sign-up')
      await expect(page.getByRole('heading', { name: 'ZPan' })).toBeVisible()

      const hasHScroll = await page.evaluate(
        () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
      )
      expect(hasHScroll).toBe(false)
    })
  }

  test('mobile: sign-in form fields are usable', async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== 'mobile', 'mobile only')
    await page.goto('/sign-in')

    // Form fields should be visible and fillable
    const emailInput = page.getByLabel(/email/i)
    const passwordInput = page.getByLabel(/password/i)
    await expect(emailInput).toBeVisible()
    await expect(passwordInput).toBeVisible()

    // Submit button should be full-width and visible
    const submitBtn = page.getByRole('button', { name: /sign in/i })
    await expect(submitBtn).toBeVisible()

    // Form container should not be wider than viewport
    const formOverflows = await page.evaluate(() => {
      const form = document.querySelector('form')
      return form ? form.scrollWidth > form.clientWidth : false
    })
    expect(formOverflows).toBe(false)
  })

  test('mobile: sign-up form fields are usable', async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== 'mobile', 'mobile only')
    await page.goto('/sign-up')

    await expect(page.getByLabel(/name/i)).toBeVisible()
    await expect(page.getByLabel(/email/i)).toBeVisible()
    await expect(page.getByLabel(/password/i)).toBeVisible()
    await expect(page.getByRole('button', { name: /sign up/i })).toBeVisible()
  })
})
