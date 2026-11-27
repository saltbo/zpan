import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { CursorPagination } from './cursor-pagination'

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, values?: { count?: number }) => (values?.count ? `${key}:${values.count}` : key),
  }),
}))

function renderPagination(overrides: Partial<Parameters<typeof CursorPagination>[0]> = {}) {
  const props = {
    pageSize: 20,
    pageSizeOptions: [20, 50, 100],
    hasPrevious: true,
    nextPageToken: 'tok-next' as string | null | undefined,
    onPageSizeChange: vi.fn(),
    onPrevious: vi.fn(),
    onNext: vi.fn(),
    ...overrides,
  }
  render(<CursorPagination {...props} />)
  return props
}

const previous = () => screen.getByRole('button', { name: 'common.previousPage' }) as HTMLButtonElement
const next = () => screen.getByRole('button', { name: 'common.nextPage' }) as HTMLButtonElement

beforeEach(() => {
  Element.prototype.scrollIntoView = vi.fn()
  HTMLElement.prototype.hasPointerCapture = vi.fn(() => false)
  HTMLElement.prototype.setPointerCapture = vi.fn()
  HTMLElement.prototype.releasePointerCapture = vi.fn()
})

afterEach(cleanup)

describe('CursorPagination', () => {
  it('enables both buttons in the middle of a list', () => {
    renderPagination()
    expect(previous().disabled).toBe(false)
    expect(next().disabled).toBe(false)
  })

  it('disables Previous on the first page', () => {
    renderPagination({ hasPrevious: false })
    expect(previous().disabled).toBe(true)
    expect(next().disabled).toBe(false)
  })

  it.each([null, undefined])('disables Next when there is no next page token (%s)', (token) => {
    renderPagination({ nextPageToken: token })
    expect(next().disabled).toBe(true)
  })

  it('disables everything while loading', () => {
    renderPagination({ disabled: true })
    expect(previous().disabled).toBe(true)
    expect(next().disabled).toBe(true)
    expect(screen.getByRole('combobox', { name: 'common.rowsPerPage' }).hasAttribute('disabled')).toBe(true)
  })

  it('calls onNext with the token and onPrevious when clicked', () => {
    const props = renderPagination()
    fireEvent.click(next())
    expect(props.onNext).toHaveBeenCalledWith('tok-next')
    fireEvent.click(previous())
    expect(props.onPrevious).toHaveBeenCalledTimes(1)
  })

  it('does not call onNext without a token', () => {
    const props = renderPagination({ nextPageToken: null })
    fireEvent.click(next())
    expect(props.onNext).not.toHaveBeenCalled()
  })

  it('shows the current page size and reports a changed one as a number', async () => {
    const props = renderPagination()
    const select = screen.getByRole('combobox', { name: 'common.rowsPerPage' })
    expect(select.textContent).toContain('common.pageSizeOption:20')

    const user = userEvent.setup()
    await user.click(select)
    await user.click(await screen.findByRole('option', { name: 'common.pageSizeOption:50' }))

    expect(props.onPageSizeChange).toHaveBeenCalledWith(50)
  })

  it('shows no page number or total', () => {
    renderPagination()
    expect(screen.queryByText(/\d+\s*\/\s*\d+/)).toBeNull()
    expect(screen.queryByText(/Page \d+/)).toBeNull()
  })
})
