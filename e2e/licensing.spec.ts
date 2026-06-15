import { expect, test } from '@playwright/test'
import { pairAndApprove, signInAsAdmin, unbindCurrentCloudBinding } from './helpers'

test.describe
  .serial('ZPan Cloud licensing', () => {
    test.afterAll(async () => {
      await unbindCurrentCloudBinding()
    })

    test('@desktop pairing activates Pro gates and unbinding revokes them', async ({ page }) => {
      test.setTimeout(300_000)
      await signInAsAdmin(page)
      await pairAndApprove(page)

      // Pro is active → a Pro-gated setting must be accepted:
      const enabled = await page.request.put('/api/site/options/auth_signup_mode', { data: { value: 'open' } })
      expect(enabled.status(), await enabled.text()).toBeLessThan(300)

      // Unbind → the same gate must close (402):
      const unbind = await page.request.delete('/api/site/licensing/binding')
      expect(unbind.ok()).toBeTruthy()
      const blocked = await page.request.put('/api/site/options/auth_signup_mode', { data: { value: 'open' } })
      expect(blocked.status()).toBe(402)
    })
  })
