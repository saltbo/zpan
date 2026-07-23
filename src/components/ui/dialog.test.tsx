import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from './dialog'

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}))

afterEach(cleanup)

describe('Dialog', () => {
  it('constrains long content to the dialog width', () => {
    render(
      <Dialog open>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Long title</DialogTitle>
            <DialogDescription>Long description</DialogDescription>
          </DialogHeader>
          <div>Long content</div>
          <DialogFooter>Actions</DialogFooter>
        </DialogContent>
      </Dialog>,
    )

    expect(screen.getByText('Long content').parentElement?.classList.contains('min-w-0')).toBe(true)
    expect(screen.getByText('Long content').parentElement?.classList.contains('[&>*]:min-w-0')).toBe(true)
    expect(screen.getByText('Long title').classList.contains('break-words')).toBe(true)
    expect(screen.getByText('Long description').classList.contains('break-words')).toBe(true)
    expect(screen.getByText('Actions').classList.contains('sm:flex-wrap')).toBe(true)
  })
})
