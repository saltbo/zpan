import { expect, test } from '@playwright/test'
import { pairAndApprove, signInAsAdmin, unbindCurrentCloudBinding } from './helpers'

test.describe
  .serial('ZPan Cloud licensing', () => {
    test.afterAll(async () => {
      await unbindCurrentCloudBinding()
    })

    test('@desktop pairing binds the instance and unbinding revokes it', async ({ page }) => {
      test.setTimeout(300_000)
      await signInAsAdmin(page)

      // Pair with the cloud; pairAndApprove polls /status until bound && active.
      await pairAndApprove(page)

      // Unbind → the binding is revoked (edition-agnostic: the cloud test account's
      // entitlements vary, so assert the licensing lifecycle, not a specific gate).
      const unbind = await page.request.delete('/api/site/licensing/binding')
      expect(unbind.ok(), await unbind.text()).toBeTruthy()

      await expect
        .poll(async () => {
          const status = await page.request.get('/api/site/licensing/status')
          return ((await status.json()) as { bound: boolean }).bound
        })
        .toBe(false)
    })
  })
