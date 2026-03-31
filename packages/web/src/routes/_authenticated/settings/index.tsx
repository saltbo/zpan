import { createFileRoute } from '@tanstack/react-router'
import { Settings } from 'lucide-react'

export const Route = createFileRoute('/_authenticated/settings/')({
  component: SettingsPage,
})

function SettingsPage() {
  return (
    <div className="flex flex-col items-center justify-center gap-4 py-20 text-muted-foreground">
      <Settings className="h-16 w-16" />
      <h2 className="text-xl font-medium">Settings</h2>
      <p className="text-sm">Profile and appearance settings will be here.</p>
    </div>
  )
}
