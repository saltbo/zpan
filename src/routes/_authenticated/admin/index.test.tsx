import { describe, expect, it, vi } from 'vitest'

const { redirect } = vi.hoisted(() => ({ redirect: vi.fn((options: unknown) => options) }))

vi.mock('@tanstack/react-router', () => ({
  createFileRoute: () => (options: unknown) => options,
  redirect,
}))

import { redirectToAdminDashboard } from './index'

describe('admin index route', () => {
  it('redirects to the dashboard route', () => {
    expect(() => redirectToAdminDashboard()).toThrow()
    expect(redirect).toHaveBeenCalledWith({ to: '/admin/dashboard' })
  })
})
