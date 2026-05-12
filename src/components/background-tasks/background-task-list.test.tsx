import type { BackgroundJob } from '@shared/types'
import { cleanup, fireEvent, render } from '@testing-library/react'
import type React from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  BackgroundTaskList,
  jobProgressPercent,
  jobResultSummary,
  jobStatusLabelKey,
  jobTypeLabelKey,
} from './background-task-list'

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}))

vi.mock('lucide-react', () => ({
  Archive: () => null,
  CircleAlert: () => null,
  CircleCheck: () => null,
  Clock3: () => null,
  Loader2: () => null,
  RotateCcw: () => null,
  Square: () => null,
}))

vi.mock('@/components/ui/badge', () => ({
  Badge: ({ children }: { children: React.ReactNode }) => <span>{children}</span>,
}))

vi.mock('@/components/ui/button', () => ({
  Button: ({
    children,
    onClick,
    title,
  }: {
    children: React.ReactNode
    onClick?: React.MouseEventHandler
    title?: string
  }) => (
    <button type="button" onClick={onClick} title={title}>
      {children}
    </button>
  ),
}))

vi.mock('@/components/ui/progress', () => ({
  Progress: ({ value }: { value: number }) => <div role="progressbar" aria-valuenow={value} />,
}))

afterEach(cleanup)

function makeJob(overrides: Partial<BackgroundJob> = {}): BackgroundJob {
  return {
    id: 'job-1',
    orgId: 'org-1',
    userId: 'user-1',
    type: 'archive_compress',
    status: 'queued',
    targetFolder: '',
    targetPath: null,
    metadata: null,
    progress: { inputBytes: 100, outputBytes: 0, processedBytes: 25, fileCount: 2, currentFilename: 'a.txt' },
    errorMessage: null,
    resultMetadata: null,
    retryable: false,
    cancelable: false,
    retriedFromJobId: null,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    startedAt: null,
    finishedAt: null,
    ...overrides,
  }
}

describe('BackgroundTaskList helpers', () => {
  it('keeps archive labels type-specific and unknown types generic', () => {
    expect(jobTypeLabelKey('archive_compress')).toBe('tasks.type.archive_compress')
    expect(jobTypeLabelKey('remote_download')).toBe('remote_download')
  })

  it('maps every status to a label key', () => {
    expect(jobStatusLabelKey('queued')).toBe('tasks.status.queued')
    expect(jobStatusLabelKey('running')).toBe('tasks.status.running')
    expect(jobStatusLabelKey('completed')).toBe('tasks.status.completed')
    expect(jobStatusLabelKey('failed')).toBe('tasks.status.failed')
    expect(jobStatusLabelKey('canceled')).toBe('tasks.status.canceled')
  })

  it('computes progress from processed and input bytes', () => {
    expect(jobProgressPercent(makeJob())).toBe(25)
    expect(
      jobProgressPercent(makeJob({ status: 'completed', progress: { ...makeJob().progress, inputBytes: 0 } })),
    ).toBe(100)
  })

  it('summarizes completed archive results and failures', () => {
    expect(jobResultSummary(makeJob({ resultMetadata: { outputName: 'Docs.zip' } }))).toBe('Docs.zip')
    expect(jobResultSummary(makeJob({ resultMetadata: { matterIds: ['a', 'b'] } }))).toBe('2')
    expect(jobResultSummary(makeJob({ errorMessage: 'Invalid ZIP archive' }))).toBe('Invalid ZIP archive')
  })
})

describe('BackgroundTaskList rendering', () => {
  it('renders empty state when there are no jobs', () => {
    const { getByText } = render(<BackgroundTaskList jobs={[]} onCancel={vi.fn()} onRetry={vi.fn()} />)

    expect(getByText('tasks.empty')).toBeTruthy()
  })

  it('renders queued, running, completed, failed, and canceled jobs', () => {
    const jobs = [
      makeJob({ id: 'queued', status: 'queued' }),
      makeJob({ id: 'running', status: 'running' }),
      makeJob({ id: 'completed', status: 'completed', resultMetadata: { outputName: 'Archive.zip' } }),
      makeJob({ id: 'failed', status: 'failed', errorMessage: 'Path traversal is not allowed', retryable: true }),
      makeJob({ id: 'canceled', status: 'canceled' }),
    ]

    const { getByText } = render(<BackgroundTaskList jobs={jobs} onCancel={vi.fn()} onRetry={vi.fn()} />)

    expect(getByText('tasks.status.queued')).toBeTruthy()
    expect(getByText('tasks.status.running')).toBeTruthy()
    expect(getByText('tasks.status.completed')).toBeTruthy()
    expect(getByText('tasks.status.failed')).toBeTruthy()
    expect(getByText('tasks.status.canceled')).toBeTruthy()
    expect(getByText('Archive.zip')).toBeTruthy()
    expect(getByText('Path traversal is not allowed')).toBeTruthy()
  })

  it('calls retry and cancel handlers only for eligible jobs', () => {
    const onCancel = vi.fn()
    const onRetry = vi.fn()
    const jobs = [
      makeJob({ id: 'running', status: 'running', cancelable: true }),
      makeJob({ id: 'failed', status: 'failed', retryable: true }),
    ]

    const { getByTitle } = render(<BackgroundTaskList jobs={jobs} onCancel={onCancel} onRetry={onRetry} />)

    fireEvent.click(getByTitle('tasks.cancel'))
    fireEvent.click(getByTitle('tasks.retry'))

    expect(onCancel).toHaveBeenCalledWith(jobs[0])
    expect(onRetry).toHaveBeenCalledWith(jobs[1])
  })
})
