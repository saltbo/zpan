import { expect, test } from '@playwright/test'
import { createFolder, signUpAndGoToFiles } from './helpers'

// ---------------------------------------------------------------------------
// Sidebar behavior per device
// ---------------------------------------------------------------------------
test.describe('Sidebar responsive behavior', () => {
  test('desktop: sidebar is visible by default @desktop', async ({ page }) => {
    await signUpAndGoToFiles(page)

    const sidebar = page.locator('[data-slot="sidebar"]')
    await expect(sidebar).toBeVisible()
  })

  test('tablet: sidebar is visible by default @tablet', async ({ page }) => {
    await signUpAndGoToFiles(page)

    const sidebar = page.locator('[data-slot="sidebar"]')
    await expect(sidebar).toBeVisible()
  })

  test('mobile: sidebar is hidden, opens as sheet via trigger @mobile', async ({ page }) => {
    await signUpAndGoToFiles(page)

    // Sidebar should not be visible initially on mobile
    const sidebar = page.locator('[data-slot="sidebar"]')
    await expect(sidebar).not.toBeInViewport()

    // Trigger button should be visible
    const trigger = page.locator('button[data-sidebar="trigger"]')
    await expect(trigger).toBeVisible()

    // Click trigger to open sheet sidebar
    await trigger.click()
    await expect(sidebar).toBeVisible()
  })
})

// ---------------------------------------------------------------------------
// Toolbar: no horizontal overflow, key buttons accessible
// ---------------------------------------------------------------------------
test.describe('Toolbar responsive layout', () => {
  test('desktop: all toolbar buttons visible in one row @desktop', async ({ page }) => {
    await signUpAndGoToFiles(page)

    const toolbar = page.locator('[data-testid="files-toolbar"]')
    await expect(toolbar).toBeVisible()

    // Primary file actions live in the page header on desktop.
    const pageHeader = page.getByTestId('page-header')
    await expect(pageHeader).toBeVisible()
    await expect(pageHeader.getByRole('button', { name: /Upload/i })).toBeVisible()
    await expect(pageHeader.getByRole('button', { name: /New Folder/i })).toBeVisible()
    await expect(page.getByLabel('List view')).toBeVisible()
    await expect(page.getByLabel('Grid view')).toBeVisible()

    await expect(page.getByTestId('global-search')).toBeVisible()
  })

  test('tablet: toolbar does not overflow horizontally @tablet', async ({ page }) => {
    await signUpAndGoToFiles(page)

    const toolbar = page.locator('[data-testid="files-toolbar"]')
    await expect(toolbar).toBeVisible()

    const overflows = await toolbar.evaluate((el) => el.scrollWidth > el.clientWidth)
    expect(overflows).toBe(false)

    await expect(page.getByTestId('page-header').getByRole('button', { name: 'Upload' })).toBeVisible()
  })

  test('mobile: toolbar does not overflow, upload button accessible @mobile', async ({ page }) => {
    await signUpAndGoToFiles(page)

    const toolbar = page.locator('[data-testid="files-toolbar"]')
    await expect(toolbar).toBeVisible()

    const overflows = await toolbar.evaluate((el) => el.scrollWidth > el.clientWidth)
    expect(overflows).toBe(false)

    await expect(page.getByTestId('page-header').getByRole('button', { name: /upload/i })).toBeVisible()
    await expect(page.getByRole('button', { name: /new folder|folder/i })).toBeVisible()
  })
})

// ---------------------------------------------------------------------------
// Table: secondary columns hidden on small screens
// ---------------------------------------------------------------------------
test.describe('File table responsive columns', () => {
  test('row actions and list/grid context menus expose the same file actions @desktop', async ({ page }) => {
    await signUpAndGoToFiles(page)
    await createFolder(page, 'menu-parity-folder')

    const row = page.getByRole('row', { name: /menu-parity-folder/ })
    await row.getByRole('button', { name: 'Actions' }).click()
    const rowActions = await page.locator('[data-slot="dropdown-menu-content"]').getByRole('menuitem').allTextContents()
    await page.keyboard.press('Escape')

    await row.click({ button: 'right' })
    const listContextActions = await page
      .locator('[data-slot="context-menu-content"]')
      .getByRole('menuitem')
      .allTextContents()
    await page.keyboard.press('Escape')

    await page.getByLabel('Grid view').click()
    await page.getByRole('button', { name: /menu-parity-folder/ }).click({ button: 'right' })
    const gridContextActions = await page
      .locator('[data-slot="context-menu-content"]')
      .getByRole('menuitem')
      .allTextContents()

    expect(listContextActions).toEqual(rowActions)
    expect(gridContextActions).toEqual(rowActions)
  })

  test('desktop: creator uses an avatar-only column with identity details on hover @desktop', async ({ page }) => {
    await signUpAndGoToFiles(page)

    await createFolder(page, 'test-folder')

    await expect(page.getByRole('columnheader', { name: /size/i })).toBeVisible()
    await expect(page.getByRole('columnheader', { name: /modified/i })).toBeVisible()
    await expect(page.getByRole('columnheader', { name: /creator/i })).toBeVisible()

    const row = page.getByRole('row', { name: /test-folder/ })
    const creatorCell = row.getByRole('cell').nth(4)
    const creatorTrigger = creatorCell.getByRole('button', { name: /created by:/i })
    await expect(creatorTrigger).toBeVisible()
    const creatorLabel = await creatorTrigger.getAttribute('aria-label')
    const creatorName = creatorLabel?.replace(/^Created by:\s*/i, '')
    expect(creatorName).toBeTruthy()
    await expect(creatorTrigger).not.toContainText(creatorName!)

    await creatorTrigger.hover()
    const identityCard = page.locator('[data-slot="hover-card-content"]')
    await expect(identityCard).toBeVisible()
    await expect(identityCard.getByText(creatorName!, { exact: true })).toBeVisible()
    await expect(identityCard.getByText('User', { exact: true })).toBeVisible()

    await page.getByLabel('Grid view').click()
    const gridCard = page.getByRole('button', { name: /test-folder/ })
    await expect(gridCard).toBeVisible()
    await expect(gridCard).not.toContainText(creatorName!)

    await page.getByLabel('List view').click()

    await row.getByRole('button').last().click()
    await page.getByRole('menuitem', { name: /details/i }).click()
    const details = page.getByRole('dialog', { name: 'test-folder' })
    await expect(details.getByText(/created by/i)).toBeVisible()
    await expect(details.getByTitle(creatorName!)).toBeVisible()
  })

  test('desktop: creator hover card contains long identity fields @desktop', async ({ page }) => {
    await signUpAndGoToFiles(page)
    await createFolder(page, 'long-actor-folder')

    const actorName = 'Automation identity with a deliberately long display name that must remain inside the card'
    const actorIssuer = `https://${'identity-segment-'.repeat(8)}example.com`
    await page.route('**/api/objects?*', async (route) => {
      const response = await route.fetch()
      const body = (await response.json()) as {
        items: Array<{ name: string; createdBy: unknown }>
      }
      for (const item of body.items) {
        if (item.name !== 'long-actor-folder') continue
        item.createdBy = {
          type: 'agent',
          ref: 'agent-0123456789abcdef0123456789abcdef',
          issuer: actorIssuer,
          name: actorName,
          image: null,
          resolved: true,
        }
      }
      await route.fulfill({ response, json: body })
    })
    await page.reload()

    const row = page.getByRole('row', { name: /long-actor-folder/ })
    await row.getByRole('button', { name: `Created by: ${actorName}` }).hover()
    const card = page.locator('[data-slot="hover-card-content"]')
    await expect(card).toBeVisible()

    const contained = await card.evaluate((element) => {
      const cardRect = element.getBoundingClientRect()
      const fields = element.querySelectorAll('[data-actor-field]')
      return (
        getComputedStyle(element).overflowX === 'hidden' &&
        [...fields].every((field) => {
          const rect = field.getBoundingClientRect()
          return rect.left >= cardRect.left && rect.right <= cardRect.right
        })
      )
    })
    expect(contained).toBe(true)
  })

  test('mobile: size and modified columns are hidden @mobile', async ({ page }) => {
    await signUpAndGoToFiles(page)

    await createFolder(page, 'test-folder')

    await expect(page.getByRole('columnheader', { name: /size/i })).not.toBeVisible()
    await expect(page.getByRole('columnheader', { name: /modified/i })).not.toBeVisible()
    await expect(page.getByRole('columnheader', { name: /name/i })).toBeVisible()
  })
})

// ---------------------------------------------------------------------------
// Page-level: no horizontal scroll on any device
// ---------------------------------------------------------------------------
test.describe('No horizontal overflow', () => {
  test('page has no horizontal scrollbar @all', async ({ page }) => {
    await signUpAndGoToFiles(page)

    const hasHScroll = await page.evaluate(
      () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
    )
    expect(hasHScroll).toBe(false)
  })
})
