import { createFileRoute, Outlet } from '@tanstack/react-router'
import { PreferenceControls } from '@/components/layout/preference-controls'

export const Route = createFileRoute('/(auth)')({
  component: AuthLayout,
})

/** Sign-in, sign-up, and password pages need no session, so they carry language and theme themselves. */
function AuthLayout() {
  return (
    <div className="flex min-h-dvh flex-col">
      <header className="flex justify-end p-2 sm:p-4">
        <PreferenceControls />
      </header>
      <Outlet />
    </div>
  )
}
