import type { MatterMetadata, MediaMetadata } from '@shared/schemas'

const IMAGE_FIELDS = ['poster', 'fanart', 'still'] as const

// Rewrites the image references of `media` through `resolve`, which returns the
// id an image has now, or undefined when the image is not there. A reference
// that does not resolve is dropped, so the metadata never names an image that
// is missing from the matter's space.
export function remapMediaImages(
  media: MediaMetadata,
  resolve: (imageId: string) => string | undefined,
): MediaMetadata {
  const remapped: Record<string, unknown> = { ...media }
  for (const field of IMAGE_FIELDS) {
    const imageId = remapped[field]
    if (typeof imageId !== 'string') continue
    const resolved = resolve(imageId)
    if (resolved === undefined) delete remapped[field]
    else remapped[field] = resolved
  }
  return remapped as MediaMetadata
}

export function hasMediaImages(media: MediaMetadata): boolean {
  return IMAGE_FIELDS.some((field) => field in media)
}

// The metadata a matter carries into another space before its images exist
// there: everything, with the image references left out.
export function metadataWithoutImages(metadata: MatterMetadata | null | undefined): MatterMetadata | null {
  if (!metadata) return null
  if (!metadata.media) return metadata
  return { ...metadata, media: remapMediaImages(metadata.media, () => undefined) }
}
