import { createFileRoute } from '@tanstack/react-router'
import { ImageUp } from 'lucide-react'

export const Route = createFileRoute('/_authenticated/images/')({
  component: ImageBedPage,
})

function ImageBedPage() {
  return (
    <div className="flex flex-col items-center justify-center gap-4 py-20 text-muted-foreground">
      <ImageUp className="h-16 w-16" />
      <h2 className="text-xl font-medium">Coming in v2.1</h2>
      <p className="text-sm">Upload images and get shareable links instantly.</p>
    </div>
  )
}
