export type SidecarFormat = 'srt' | 'vtt' | 'ass' | 'ssa'

const SIDECAR_FORMATS: ReadonlySet<string> = new Set<SidecarFormat>(['srt', 'vtt', 'ass', 'ssa'])

export interface SidecarMatch {
  format: SidecarFormat
  /** What sits between the video's base name and the extension: "chs" for movie.chs.srt, "" for movie.srt. */
  tag: string
}

function splitExtension(name: string): [string, string] {
  const dot = name.lastIndexOf('.')
  return dot <= 0 ? [name, ''] : [name.slice(0, dot), name.slice(dot + 1).toLowerCase()]
}

/** Whether `name` is a subtitle file for `videoName`, following the movie[.tag].ext convention players use. */
export function matchSidecarSubtitle(videoName: string, name: string): SidecarMatch | null {
  const [videoBase] = splitExtension(videoName)
  const [base, extension] = splitExtension(name)
  if (!SIDECAR_FORMATS.has(extension)) return null
  const videoKey = videoBase.toLowerCase()
  const key = base.toLowerCase()
  if (key === videoKey) return { format: extension as SidecarFormat, tag: '' }
  if (!key.startsWith(`${videoKey}.`)) return null
  return { format: extension as SidecarFormat, tag: base.slice(videoBase.length + 1) }
}

/**
 * Subtitle files are usually UTF-8, but Chinese releases still ship many in GBK. Decoding strictly
 * as UTF-8 first and falling back to GB18030 (a GBK superset) covers both without guessing.
 */
export function decodeSubtitleText(bytes: Uint8Array): string {
  if (bytes[0] === 0xff && bytes[1] === 0xfe) return new TextDecoder('utf-16le').decode(bytes)
  if (bytes[0] === 0xfe && bytes[1] === 0xff) return new TextDecoder('utf-16be').decode(bytes)
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes)
  } catch {
    return new TextDecoder('gb18030').decode(bytes)
  }
}
