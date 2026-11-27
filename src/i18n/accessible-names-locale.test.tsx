import { cleanup, render, screen } from '@testing-library/react'
import { Trans } from 'react-i18next'
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'
import { AdminFormLabel } from '@/components/admin/admin-form-drawer'
import { ComparisonTable } from '@/components/billing/ComparisonTable'
import { FilesToolbar } from '@/components/files/files-toolbar'
import i18n, { i18nReady } from '@/i18n'

beforeAll(async () => {
  await i18nReady
  await i18n.changeLanguage('zh')
})

afterAll(async () => {
  await i18n.changeLanguage('en')
})

afterEach(cleanup)

describe('accessible names in Chinese [spec: language/accessible-names]', () => {
  it('names the list and grid view toggles in Chinese', () => {
    render(<FilesToolbar viewMode="list" onViewModeChange={() => {}} selectedCount={0} totalItems={0} />)
    expect(screen.getByRole('radio', { name: '列表视图' })).toBeTruthy()
    expect(screen.getByRole('radio', { name: '网格视图' })).toBeTruthy()
  })

  it('names the admin form help button in Chinese', () => {
    render(
      <AdminFormLabel htmlFor="name" help="说明">
        名称
      </AdminFormLabel>,
    )
    expect(screen.getByRole('button', { name: '帮助' })).toBeTruthy()
  })

  it('names the comparison table marks in Chinese', () => {
    render(<ComparisonTable />)
    expect(screen.getAllByLabelText('包含').length).toBeGreaterThan(0)
    expect(screen.getAllByLabelText('不包含').length).toBeGreaterThan(0)
  })

  it('renders the Powered by footer in Chinese around the ZPan link', () => {
    const { container } = render(
      <p>
        <Trans i18nKey="common.poweredBy" components={{ repo: <a href="https://github.com/saltbo/zpan">ZPan</a> }} />
      </p>,
    )
    expect(container.textContent).toBe('由 ZPan 驱动')
    expect(screen.getByRole('link', { name: 'ZPan' }).getAttribute('href')).toBe('https://github.com/saltbo/zpan')
  })
})
