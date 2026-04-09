import Lightbox from 'yet-another-react-lightbox'
import Fullscreen from 'yet-another-react-lightbox/plugins/fullscreen'
import Zoom from 'yet-another-react-lightbox/plugins/zoom'
import 'yet-another-react-lightbox/styles.css'

interface ImagePreviewProps {
  url: string
  filename: string
  siblingImages?: Array<{ url: string; filename: string }>
}

export function ImagePreview({ url, filename, siblingImages }: ImagePreviewProps) {
  const singleSlide = [{ src: url, alt: filename }]
  const siblingSlides = siblingImages?.map((img) => ({ src: img.url, alt: img.filename }))
  const matchIndex = siblingImages?.findIndex((img) => img.url === url) ?? -1
  const slides = matchIndex >= 0 && siblingSlides ? siblingSlides : singleSlide
  const startIndex = matchIndex >= 0 ? matchIndex : 0

  return (
    <div className="flex h-full items-center justify-center">
      <Lightbox
        open
        close={() => {}} // Close is handled by the parent dialog
        slides={slides}
        index={startIndex}
        plugins={[Zoom, Fullscreen]}
        carousel={{ finite: slides.length <= 1 }}
        controller={{ closeOnBackdropClick: false }}
        render={{
          buttonPrev: slides.length <= 1 ? () => null : undefined,
          buttonNext: slides.length <= 1 ? () => null : undefined,
          buttonClose: () => null,
        }}
        styles={{
          container: { backgroundColor: 'transparent', position: 'relative' },
          root: { '--yarl__color_backdrop': 'transparent' } as Record<string, string>,
        }}
      />
    </div>
  )
}
