import type { AdminOverview } from '@shared/types'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { getAdminOverview } from '@/lib/api'
import { AdminOverviewPage } from './dashboard'

vi.mock('@tanstack/react-router', () => ({
  createFileRoute: () => (options: unknown) => options,
}))

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, values?: Record<string, string | number>) => {
      if (!values) return key
      return Object.entries(values).reduce(
        (message, [name, value]) => message.replace(`{{${name}}}`, String(value)),
        key,
      )
    },
  }),
}))

vi.mock('@/lib/api', () => ({
  getAdminOverview: vi.fn(),
}))

vi.mock('recharts', async () => {
  const React = await import('react')
  const Component = ({ children }: { children?: ReactNode }) => React.createElement('div', null, children)
  const AreaComponent = ({ dot }: { dot?: unknown }) =>
    React.createElement('div', { 'data-testid': 'storage-area', 'data-has-dot': dot ? 'true' : 'false' })
  return {
    Area: AreaComponent,
    Bar: Component,
    CartesianGrid: Component,
    Cell: Component,
    ComposedChart: Component,
    Line: Component,
    LineChart: Component,
    Pie: Component,
    PieChart: Component,
    ReferenceLine: Component,
    ResponsiveContainer: Component,
    Tooltip: Component,
    XAxis: Component,
    YAxis: Component,
  }
})

const overview: AdminOverview = {
  observedAt: '2026-07-20T18:00:00.000Z',
  users: {
    total: 42,
    active30Days: 18,
    new7Days: 5,
    activity: { total: 40, today: 3, last7Days: 5, last30Days: 10, inactive: 24 },
    trend: [{ date: '2026-07-20', totalUsers: 42, activeUsers: 18, newUsers: 2 }],
    topUsage: [
      {
        userId: 'user-1',
        name: 'Ada',
        email: 'ada@example.com',
        usedBytes: 400,
        quotaBytes: 1000,
        utilization: 40,
      },
    ],
  },
  storages: {
    total: 1,
    writable: 1,
    used: 400,
    capacity: 1000,
    unbounded: 0,
    trend: [{ date: '2026-07-20', usedBytes: 400, writtenBytes: 120, releasedBytes: 20 }],
    items: [
      {
        id: 'storage-1',
        provider: 'aws-s3',
        bucket: 'files',
        status: 'active',
        used: 400,
        capacity: 1000,
        writable: true,
      },
    ],
  },
  downloaders: {
    total: 2,
    online: 1,
    activeTasks: 2,
    totalSlots: 4,
    availableSlots: 2,
    downloadBps: 1024,
    uploadBps: 512,
    items: [
      {
        id: 'downloader-1',
        name: 'edge-1',
        status: 'online',
        currentTasks: 2,
        maxConcurrentTasks: 4,
        downloadBps: 1024,
        uploadBps: 512,
        freeDiskBytes: 2048,
        lastHeartbeatAt: '2026-07-20T17:59:55.000Z',
      },
      {
        id: 'downloader-2',
        name: 'nas',
        status: 'offline',
        currentTasks: 0,
        maxConcurrentTasks: 2,
        downloadBps: 0,
        uploadBps: 0,
        freeDiskBytes: 0,
        lastHeartbeatAt: null,
      },
    ],
  },
}

function renderPage() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={queryClient}>
      <AdminOverviewPage />
    </QueryClientProvider>,
  )
}

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

describe('AdminOverviewPage', () => {
  it('renders the four-row user and storage dashboard with registered downloaders', async () => {
    vi.mocked(getAdminOverview).mockResolvedValue(overview)

    renderPage()

    expect(await screen.findByText('admin.overview.metrics.totalUsers')).toBeTruthy()
    expect(screen.getByText('admin.overview.users.trendTitle')).toBeTruthy()
    expect(screen.getByText('admin.overview.users.activityTitle')).toBeTruthy()
    expect(screen.getByText('admin.overview.storage.trendTitle')).toBeTruthy()
    expect(screen.getByText('admin.overview.storage.written')).toBeTruthy()
    expect(screen.getByText('admin.overview.storage.released')).toBeTruthy()
    expect(screen.getByTestId('storage-area').getAttribute('data-has-dot')).toBe('true')
    expect(screen.getByText('40')).toBeTruthy()
    expect(screen.getByText('admin.overview.storage.usageTitle')).toBeTruthy()
    expect(screen.getByText('admin.overview.topUsers.title')).toBeTruthy()
    expect(screen.getByText('admin.overview.backends.title')).toBeTruthy()
    expect(screen.getByText('admin.overview.downloaders.title')).toBeTruthy()
    expect(screen.getByText('Ada')).toBeTruthy()
    expect(screen.getByText('aws-s3')).toBeTruthy()
    expect(screen.getByText('edge-1')).toBeTruthy()
    expect(screen.getByText('nas')).toBeTruthy()
    expect(screen.queryByText('最近协作动态')).toBeNull()
    expect(screen.queryByText('容量风险')).toBeNull()

    for (const title of [
      'admin.overview.topUsers.title',
      'admin.overview.backends.title',
      'admin.overview.downloaders.title',
    ]) {
      const card = screen.getByText(title).closest('[data-slot="card"]')
      expect(card?.className).toContain('h-[24rem]')
      expect(card?.querySelector('[data-slot="card-content"]')?.className).toContain('overflow-y-auto')
    }
  })

  it('shows resource-specific empty states', async () => {
    vi.mocked(getAdminOverview).mockResolvedValue({
      ...overview,
      users: { ...overview.users, topUsage: [] },
      storages: { ...overview.storages, total: 0, writable: 0, used: 0, capacity: 0, items: [] },
      downloaders: { ...overview.downloaders, total: 0, online: 0, items: [] },
    })

    renderPage()

    expect(await screen.findByText('admin.overview.topUsers.empty')).toBeTruthy()
    expect(screen.getByText('admin.overview.backends.empty')).toBeTruthy()
    expect(screen.getByText('admin.overview.downloaders.empty')).toBeTruthy()
  })

  it('lets the administrator retry a failed overview request', async () => {
    vi.mocked(getAdminOverview).mockRejectedValueOnce(new Error('offline')).mockResolvedValueOnce(overview)

    renderPage()

    fireEvent.click(await screen.findByRole('button', { name: 'admin.overview.retry' }))

    await waitFor(() => expect(getAdminOverview).toHaveBeenCalledTimes(2))
    expect(await screen.findByText('admin.overview.metrics.totalUsers')).toBeTruthy()
  })
})
