import Lightbox from 'yet-another-react-lightbox'
import Fullscreen from 'yet-another-react-lightbox/plugins/fullscreen'
import Zoom from 'yet-another-react-lightbox/plugins/zoom'
import 'yet-another-react-lightbox/styles.css'

interface ImagePreviewProps {
  url: string
  filename: string
  /** URLs of other images in the same folder for gallery navigation */
  siblingUrls?: Array<{ url: string; filename: string }>
}

export function ImagePreview({ url, filename, siblingUrls }: ImagePreviewProps) {
  const slides = siblingUrls?.length
    ? siblingUrls.map((s) => ({ src: s.url, alt: s.filename }))
    : [{ src: url, alt: filename }]

  const startIndex = siblingUrls?.length ? siblingUrls.findIndex((s) => s.url === url) : 0

  return (
    <div className="flex h-full items-center justify-center">
      {/* Lightbox is always open — close is handled by the parent dialog */}
      <Lightbox
        open
        close={() => {}}
        slides={slides}
        index={Math.max(0, startIndex)}
        plugins={[Zoom, Fullscreen]}
        controller={{ closeOnBackdropClick: false }}
        styles={{
          container: { backgroundColor: 'transparent' },
          root: { '--yarl__color_backdrop': 'transparent' } as Record<string, string>,
        }}
        render={{
          buttonClose: () => null,
        }}
        carousel={{ finite: !siblingUrls?.length }}
      />
    </div>
  )
}
