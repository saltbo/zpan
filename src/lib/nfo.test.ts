import { DirType, ObjectStatus } from '@shared/constants'
import type { StorageObject } from '@shared/types'
import { describe, expect, it } from 'vitest'
import { filenameStem, findVideoCompanions, parseMovieNfo } from './nfo'

function file(name: string): StorageObject {
  return {
    id: name,
    orgId: 'org-1',
    alias: name,
    name,
    type: 'application/octet-stream',
    size: 100,
    dirtype: DirType.FILE,
    parent: 'Movies',
    object: name,
    storageId: 'storage-1',
    status: ObjectStatus.ACTIVE,
    trashedAt: null,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  }
}

function video(name: string): StorageObject {
  return { ...file(name), type: 'video/x-matroska' }
}

describe('filenameStem', () => {
  it('removes only the final extension', () => {
    expect(filenameStem('Movie.2026.1080p.mkv')).toBe('Movie.2026.1080p')
    expect(filenameStem('.hidden')).toBe('.hidden')
  })
})

describe('findVideoCompanions', () => {
  it('matches case-insensitive same-stem NFO and prefers same-stem poster', () => {
    const movie = video('Arrival.mkv')
    const nfo = file('ARRIVAL.NFO')
    const stemPoster = file('arrival-poster.webp')
    const folderPoster = file('poster.jpg')

    expect(findVideoCompanions(movie, [movie, nfo, folderPoster, stemPoster])).toEqual({
      nfo,
      poster: stemPoster,
    })
  })

  it('falls back to a folder poster', () => {
    const movie = video('Arrival.mkv')
    const poster = file('folder.png')

    expect(findVideoCompanions(movie, [movie, poster])).toEqual({ nfo: null, poster })
  })

  it('uses movie.nfo only when the directory contains one video', () => {
    const movie = video('Arrival.mkv')
    const nfo = file('movie.nfo')

    expect(findVideoCompanions(movie, [movie, nfo]).nfo).toBe(nfo)
    expect(findVideoCompanions(movie, [movie, video('Blade Runner.mkv'), nfo]).nfo).toBeNull()
  })
})

describe('parseMovieNfo', () => {
  it('parses common Kodi movie fields', () => {
    const movie = parseMovieNfo(`
      <movie>
        <title>Arrival</title>
        <originaltitle>Arrival</originaltitle>
        <year>2016</year>
        <plot>A linguist works with the military.</plot>
        <tagline>Why are they here?</tagline>
        <ratings><rating default="true"><value>7.9</value></rating></ratings>
        <runtime>116</runtime>
        <premiered>2016-11-11</premiered>
        <genre>Science Fiction</genre>
        <genre>Drama</genre>
        <director>Denis Villeneuve</director>
        <actor><name>Amy Adams</name></actor>
        <actor><name>Jeremy Renner</name></actor>
      </movie>
    `)

    expect(movie).toEqual({
      title: 'Arrival',
      originalTitle: 'Arrival',
      year: 2016,
      plot: 'A linguist works with the military.',
      tagline: 'Why are they here?',
      rating: 7.9,
      runtime: 116,
      premiered: '2016-11-11',
      genres: ['Science Fiction', 'Drama'],
      directors: ['Denis Villeneuve'],
      actors: ['Amy Adams', 'Jeremy Renner'],
    })
  })

  it('rejects malformed XML and non-movie NFO files', () => {
    expect(parseMovieNfo('<movie><title>Broken</movie>')).toBeNull()
    expect(parseMovieNfo('<episodedetails><title>Episode</title></episodedetails>')).toBeNull()
  })
})
