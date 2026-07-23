import { DirType } from '@shared/constants'
import type { StorageObject } from '@shared/types'

export const MAX_NFO_BYTES = 1024 * 1024

export interface NfoMovie {
  title: string
  originalTitle?: string
  year?: number
  plot?: string
  tagline?: string
  rating?: number
  runtime?: number
  premiered?: string
  genres: string[]
  directors: string[]
  actors: string[]
}

export interface VideoCompanions {
  nfo: StorageObject | null
  poster: StorageObject | null
}

const POSTER_EXTENSIONS = ['jpg', 'jpeg', 'png', 'webp']

export function filenameStem(name: string): string {
  const dot = name.lastIndexOf('.')
  return dot > 0 ? name.slice(0, dot) : name
}

export function findVideoCompanions(video: StorageObject, directoryItems: StorageObject[]): VideoCompanions {
  const stem = filenameStem(video.name).toLocaleLowerCase()
  const files = directoryItems.filter((item) => item.dirtype === DirType.FILE)
  const filesByName = new Map(files.map((item) => [item.name.toLocaleLowerCase(), item]))
  const onlyVideoInDirectory = files.filter((item) => item.type.startsWith('video/')).length === 1
  const nfo = filesByName.get(`${stem}.nfo`) ?? (onlyVideoInDirectory ? filesByName.get('movie.nfo') : null) ?? null

  const posterNames = [
    ...POSTER_EXTENSIONS.map((extension) => `${stem}-poster.${extension}`),
    ...POSTER_EXTENSIONS.map((extension) => `${stem}.${extension}`),
    ...POSTER_EXTENSIONS.map((extension) => `poster.${extension}`),
    ...POSTER_EXTENSIONS.map((extension) => `folder.${extension}`),
  ]
  const poster = posterNames.map((name) => filesByName.get(name)).find(Boolean) ?? null

  return { nfo, poster }
}

function firstText(root: Element, tagName: string): string | undefined {
  const value = root.getElementsByTagName(tagName)[0]?.textContent?.trim()
  return value || undefined
}

function numberValue(value: string | undefined): number | undefined {
  if (!value) return undefined
  const parsed = Number.parseFloat(value)
  return Number.isFinite(parsed) ? parsed : undefined
}

function integerValue(value: string | undefined): number | undefined {
  const parsed = numberValue(value)
  return parsed === undefined ? undefined : Math.round(parsed)
}

function uniqueTexts(root: Element, tagName: string): string[] {
  const values = Array.from(root.getElementsByTagName(tagName)).flatMap((element) =>
    (element.textContent ?? '')
      .split('|')
      .map((value) => value.trim())
      .filter(Boolean),
  )
  return [...new Set(values)]
}

function actorNames(root: Element): string[] {
  return [
    ...new Set(
      Array.from(root.getElementsByTagName('actor'))
        .map((actor) => firstText(actor, 'name'))
        .filter((name): name is string => Boolean(name)),
    ),
  ]
}

export function parseMovieNfo(xml: string): NfoMovie | null {
  const document = new DOMParser().parseFromString(xml, 'application/xml')
  if (document.getElementsByTagName('parsererror').length > 0) return null

  const root = document.documentElement
  if (root.tagName.toLocaleLowerCase() !== 'movie') return null

  const title = firstText(root, 'title')
  if (!title) return null

  const nestedRating = firstText(root.getElementsByTagName('ratings')[0] ?? root, 'value')

  return {
    title,
    originalTitle: firstText(root, 'originaltitle'),
    year: integerValue(firstText(root, 'year')),
    plot: firstText(root, 'plot'),
    tagline: firstText(root, 'tagline'),
    rating: numberValue(firstText(root, 'rating') ?? nestedRating),
    runtime: integerValue(firstText(root, 'runtime')),
    premiered: firstText(root, 'premiered'),
    genres: uniqueTexts(root, 'genre'),
    directors: uniqueTexts(root, 'director'),
    actors: actorNames(root),
  }
}

function cacheKey(nfo: StorageObject): string {
  return `zpan:nfo:${nfo.id}:${nfo.updatedAt}`
}

export function readCachedMovieNfo(nfo: StorageObject): NfoMovie | null {
  try {
    const cached = localStorage.getItem(cacheKey(nfo))
    return cached ? (JSON.parse(cached) as NfoMovie) : null
  } catch {
    return null
  }
}

export function cacheMovieNfo(nfo: StorageObject, movie: NfoMovie): void {
  try {
    localStorage.setItem(cacheKey(nfo), JSON.stringify(movie))
  } catch {
    // Browser storage is an optional optimization; a full or blocked cache must not break the media view.
  }
}
