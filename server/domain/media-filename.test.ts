import type { MediaInfo } from '@shared/schemas'
import { describe, expect, it } from 'vitest'
import { parseMediaFilename, parseMediaPath } from './media-filename'

describe('parseMediaFilename', () => {
  it.each<[string, MediaInfo]>([
    ['Dune.Part.Two.2024.2160p.WEB-DL.DDP5.1.Atmos.mkv', { type: 'movie', title: 'Dune Part Two', year: 2024 }],
    ['Inception (2010).mkv', { type: 'movie', title: 'Inception', year: 2010 }],
    ['The_Matrix_[1999]_1080p.mp4', { type: 'movie', title: 'The Matrix', year: 1999 }],
    ['1917.2019.1080p.BluRay.mkv', { type: 'movie', title: '1917', year: 2019 }],
    ['Blade.Runner.2049.2017.mkv', { type: 'movie', title: 'Blade Runner 2049', year: 2017 }],
    ['Spider-Man.No.Way.Home.2021.mkv', { type: 'movie', title: 'Spider-Man No Way Home', year: 2021 }],
    ['流浪地球2.2023.4K.mkv', { type: 'movie', title: '流浪地球2', year: 2023 }],
    ['Breaking.Bad.S03E09.720p.mkv', { type: 'episode', title: 'Breaking Bad', season: 3, episode: 9 }],
    ['the.office.s01e02.mkv', { type: 'episode', title: 'the office', season: 1, episode: 2 }],
    ['Show.Name.S01.E10.mkv', { type: 'episode', title: 'Show Name', season: 1, episode: 10 }],
    ['Doctor.Who.2005.S02E01.mkv', { type: 'episode', title: 'Doctor Who', season: 2, episode: 1, year: 2005 }],
    ['Friends - 1x02 - The One with the Sonogram.avi', { type: 'episode', title: 'Friends', season: 1, episode: 2 }],
    ['权力的游戏.S03E09.mkv', { type: 'episode', title: '权力的游戏', season: 3, episode: 9 }],
    ['庆余年 第2季第3集.mp4', { type: 'episode', title: '庆余年', season: 2, episode: 3 }],
    ['S01E02.mkv', { type: 'episode', title: '', season: 1, episode: 2 }],
    ['VID_20240101_123456.mp4', { type: 'unknown', title: 'VID_20240101_123456' }],
    ['holiday-clip.mov', { type: 'unknown', title: 'holiday-clip' }],
    ['2012.mkv', { type: 'unknown', title: '2012' }],
    ['Movie.1920x1080.mkv', { type: 'unknown', title: 'Movie.1920x1080' }],
  ])('parses %s', (fileName, expected) => {
    expect(parseMediaFilename(fileName)).toEqual(expected)
  })
})

describe('parseMediaPath', () => {
  it('takes a bare episode title from the nearest non-season folder', () => {
    expect(parseMediaPath(['TV', 'The Wire (2002)', 'Season 01'], 'S01E05.mkv')).toEqual({
      type: 'episode',
      title: 'The Wire',
      season: 1,
      episode: 5,
      year: 2002,
    })
    expect(parseMediaPath(['剧集', '庆余年', '第一季'], 'S01E01.mp4')).toMatchObject({ title: '庆余年' })
  })

  it('keeps the title parsed from the filename', () => {
    expect(parseMediaPath(['TV', 'Other'], 'Breaking.Bad.S01E01.mkv')).toMatchObject({ title: 'Breaking Bad' })
    expect(parseMediaPath(['Movies'], 'Inception (2010).mkv')).toEqual({
      type: 'movie',
      title: 'Inception',
      year: 2010,
    })
  })

  it('leaves the title empty when every folder is a season folder', () => {
    expect(parseMediaPath(['Season 2'], 'S02E03.mkv')).toMatchObject({ title: '', season: 2, episode: 3 })
  })
})
