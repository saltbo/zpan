import { DirType } from '@shared/constants'
import type { StorageObject } from '@shared/types'
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { FileDetailsSheet } from './file-details-sheet'

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}))

vi.mock('./file-icon', () => ({ FileIcon: () => <span data-testid="file-icon" /> }))

const item: StorageObject = {
  id: 'file-1',
  orgId: 'org-1',
  alias: 'alias-1',
  name: 'report.pdf',
  type: 'application/pdf',
  size: 1024,
  dirtype: DirType.FILE,
  parent: 'Reports',
  object: 'object-key',
  storageId: 'storage-1',
  status: 'active',
  trashedAt: null,
  createdBy: {
    type: 'agent',
    ref: 'agent-1',
    issuer: 'https://realm.example.com',
    name: 'Report Agent',
    image: null,
    resolved: true,
  },
  createdAt: '2026-08-01T12:00:00.000Z',
  updatedAt: '2026-08-02T12:00:00.000Z',
}

afterEach(cleanup)

describe('FileDetailsSheet', () => {
  it('shows creator and file metadata', () => {
    render(<FileDetailsSheet item={item} onOpenChange={vi.fn()} />)

    expect(screen.getByText('report.pdf')).toBeTruthy()
    expect(screen.getByText('Report Agent')).toBeTruthy()
    expect(screen.getByText('/Reports')).toBeTruthy()
    expect(screen.getByText('1.0 KB')).toBeTruthy()
  })

  it('does not render without a selected item', () => {
    const { container } = render(<FileDetailsSheet item={null} onOpenChange={vi.fn()} />)

    expect(container.firstChild).toBeNull()
  })
})
