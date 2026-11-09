import { cueTextFromPayload } from './cue-text'
import { languageFromSidecarTag, languageLabel, normalizeLanguage, pickDefaultSubtitle } from './language'
import { type MkvSubtitleEntry, MkvSubtitleFile, type MkvSubtitleTrack, type RangeReader } from './mkv'
import { decodeSubtitleText, type SidecarFormat, type SidecarMatch, sanitizeSidecarContent } from './sidecar'

/** A subtitle file found for a video, with what its name says about format and language. */
export interface SidecarSubtitle extends SidecarMatch {
  /** Path relative to the video's folder, e.g. "Movie.chs.srt" or "Subs/2_English.srt". */
  name: string
  url: string
}

interface SourceBase {
  id: string
  label: string
  language: string | null
  isDefault: boolean
  isForced: boolean
}

export type SubtitleSource =
  | (SourceBase & { kind: 'file'; format: SidecarFormat; content: string })
  | (SourceBase & { kind: 'embedded'; file: MkvSubtitleFile; track: MkvSubtitleTrack })

export interface SubtitleCue {
  start: number
  end: number
  text: string
}

interface LoadOptions {
  videoUrl: string
  videoName: string
  sidecars: readonly SidecarSubtitle[]
  uiLanguage: string
  signal: AbortSignal
}

const MATROSKA_EXTENSIONS = /\.(mkv|mk3d|webm)$/i

/**
 * Every subtitle the player can offer for a video: sidecar files next to it, then the text tracks
 * inside a Matroska file. A source that fails to load is left out so the video still plays.
 */
export async function loadSubtitleSources(options: LoadOptions): Promise<SubtitleSource[]> {
  const { videoUrl, videoName, sidecars, uiLanguage, signal } = options
  const [files, embedded] = await Promise.all([
    Promise.all(sidecars.map((sidecar) => loadSidecar(sidecar, uiLanguage, signal))),
    MATROSKA_EXTENSIONS.test(videoName) ? loadEmbedded(videoUrl, uiLanguage, signal) : [],
  ])
  const sources = dedupeLabels([...files.filter((source) => source !== null), ...embedded])
  const preferred = pickDefaultSubtitle(sources, uiLanguage)
  return sources.map((source) => ({ ...source, isDefault: source === preferred }))
}

async function loadSidecar(
  sidecar: SidecarSubtitle,
  uiLanguage: string,
  signal: AbortSignal,
): Promise<SubtitleSource | null> {
  try {
    const response = await fetch(sidecar.url, { signal })
    if (!response.ok) throw new Error(`Subtitle request returned ${response.status}`)
    const content = sanitizeSidecarContent(
      sidecar.format,
      decodeSubtitleText(new Uint8Array(await response.arrayBuffer())),
    )
    const language = languageFromSidecarTag(sidecar.tag)
    return {
      kind: 'file',
      id: `file:${sidecar.name}`,
      label: (language && languageLabel(language, uiLanguage)) || sidecar.tag || sidecar.name,
      language,
      isDefault: false,
      isForced: /(^|[.&_\s(])forced($|[.&_\s)])/i.test(sidecar.tag),
      format: sidecar.format,
      content,
    }
  } catch (error) {
    if (!signal.aborted) console.error(`Failed to load subtitle ${sidecar.name}`, error)
    return null
  }
}

async function loadEmbedded(videoUrl: string, uiLanguage: string, signal: AbortSignal): Promise<SubtitleSource[]> {
  try {
    const file = await MkvSubtitleFile.open(httpRangeReader(videoUrl, signal))
    if (!file) return []
    return file.tracks
      .filter((track) => track.entries.length > 0)
      .map((track) => {
        const language = track.language ? normalizeLanguage(track.language) : null
        return {
          kind: 'embedded' as const,
          id: `embedded:${track.number}`,
          label: track.name || (language && languageLabel(language, uiLanguage)) || `#${track.number}`,
          language,
          isDefault: track.isDefault,
          isForced: track.isForced,
          file,
          track,
        }
      })
  } catch (error) {
    if (!signal.aborted) console.error('Failed to read embedded subtitles', error)
    return []
  }
}

function dedupeLabels(sources: SubtitleSource[]): SubtitleSource[] {
  const seen = new Map<string, number>()
  return sources.map((source) => {
    const count = (seen.get(source.label) ?? 0) + 1
    seen.set(source.label, count)
    return count === 1 ? source : { ...source, label: `${source.label} (${count})` }
  })
}

export function httpRangeReader(url: string, signal: AbortSignal): RangeReader {
  return async (offset, length) => {
    const response = await fetch(url, { headers: { Range: `bytes=${offset}-${offset + length - 1}` }, signal })
    if (response.status === 416) return new Uint8Array()
    // A 200 would mean the storage ignored the range and is sending the whole file.
    if (response.status !== 206) throw new Error(`Range request returned ${response.status}`)
    return new Uint8Array(await response.arrayBuffer())
  }
}

interface StreamOptions {
  file: MkvSubtitleFile
  track: MkvSubtitleTrack
  /** Blocks nearest the playhead are fetched first, so seeking re-prioritizes what loads next. */
  currentTime: () => number
  onCue: (cue: SubtitleCue) => void
  signal: AbortSignal
}

const STREAM_CONCURRENCY = 4
// A line that started this long before the playhead may still be on screen.
const LOOKBEHIND_SECONDS = 10

/** Fetches every block of an embedded track, playhead first, handing each cue over as it arrives. */
export async function streamEmbeddedCues({ file, track, currentTime, onCue, signal }: StreamOptions): Promise<void> {
  const pending = [...track.entries].sort((a, b) => a.start - b.start)
  const next = (): MkvSubtitleEntry | undefined => {
    const from = currentTime() - LOOKBEHIND_SECONDS
    const index = pending.findIndex((entry) => entry.start >= from)
    return pending.splice(index === -1 ? pending.length - 1 : index, 1)[0]
  }
  const worker = async () => {
    for (let entry = next(); entry && !signal.aborted; entry = next()) {
      const block = await file.readBlock(track, entry)
      const text = block && cueTextFromPayload(track.format, block.payload)
      if (block && text && !signal.aborted) onCue({ start: block.start, end: block.end, text })
    }
  }
  await Promise.all(Array.from({ length: STREAM_CONCURRENCY }, worker))
}
