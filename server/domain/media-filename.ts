import type { MediaInfo } from '@shared/schemas'

// Filename conventions used by release groups and media servers. Separators
// around tokens are any of . _ - space and brackets.
const SEP = String.raw`[.\s_\-()[\]]`
const YEAR = new RegExp(String.raw`(?:^|${SEP})((?:19|20)\d{2})(?=$|${SEP})`, 'g')
const EPISODE_PATTERNS = [
  new RegExp(String.raw`(?:^|${SEP})S(\d{1,2})${SEP}?E(\d{1,3})(?=$|${SEP}|E\d)`, 'i'),
  new RegExp(String.raw`(?:^|${SEP})(\d{1,2})x(\d{2,3})(?=$|${SEP})`, 'i'),
  /第\s*(\d{1,2})\s*季\s*第\s*(\d{1,4})\s*[集话話]/,
]
const SEASON_FOLDER = /^(?:season|series|s)\s*\d+$|^第\s*\S+\s*季$|^specials?$/i
const EXTENSION = /\.[a-z0-9]{2,5}$/i

export function parseMediaFilename(fileName: string): MediaInfo {
  const base = fileName.replace(EXTENSION, '')

  for (const pattern of EPISODE_PATTERNS) {
    const match = pattern.exec(base)
    if (!match) continue
    const show = titleAndYear(base.slice(0, match.index))
    return {
      type: 'episode',
      title: show.title,
      season: Number(match[1]),
      episode: Number(match[2]),
      ...(show.year === undefined ? {} : { year: show.year }),
    }
  }

  const movie = titleAndYear(base)
  if (movie.year !== undefined) return { type: 'movie', title: movie.title, year: movie.year }
  return { type: 'unknown', title: base }
}

// Parses a file inside a library. `folders` lists the ancestor folder names from
// the library root down to the file's parent; a bare `S01E02.mkv` takes its show
// title from the nearest folder that is not a season folder.
export function parseMediaPath(folders: readonly string[], fileName: string): MediaInfo {
  const info = parseMediaFilename(fileName)
  if (info.type !== 'episode' || info.title) return info

  const showFolder = [...folders].reverse().find((folder) => !SEASON_FOLDER.test(folder.trim()))
  if (!showFolder) return info
  const show = titleAndYear(showFolder)
  return { ...info, title: show.title, ...(show.year === undefined ? {} : { year: show.year }) }
}

// The last year token with a non-empty title before it wins, so a title that is
// itself a year ("1917.2019", "Blade.Runner.2049.2017") keeps its year in the title.
function titleAndYear(text: string): { title: string; year?: number } {
  let found: { title: string; year: number } | null = null
  for (const match of text.matchAll(YEAR)) {
    const title = cleanTitle(text.slice(0, match.index))
    if (title) found = { title, year: Number(match[1]) }
  }
  return found ?? { title: cleanTitle(text) }
}

function cleanTitle(text: string): string {
  return text
    .replace(/[._]+/g, ' ')
    .replace(/\s+/g, ' ')
    .replace(/^[\s\-–—:([{]+|[\s\-–—:([{]+$/g, '')
}
