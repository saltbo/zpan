import Lightbox from 'yet-another-react-lightbox'
import FullscreenPlugin from 'yet-another-react-lightbox/plugins/fullscreen'
import ZoomPlugin from 'yet-another-react-lightbox/plugins/zoom'
import 'yet-another-react-lightbox/styles.css'

interface ImagePreviewProps {
  url: string
  filename: string
  open: boolean
  onClose: () => void
}

export function ImagePreview({ url, filename, open, onClose }: ImagePreviewProps) {
  return (
    <Lightbox
      open={open}
      close={onClose}
      slides={[{ src: url, alt: filename }]}
      plugins={[ZoomPlugin, FullscreenPlugin]}
      carousel={{ finite: true }}
      render={{ buttonPrev: () => null, buttonNext: () => null }}
    />
  )
}
