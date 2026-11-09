import { describe, expect, it } from 'vitest'
import { decodeSubtitleText, matchSidecarSubtitle } from './sidecar'

describe('matchSidecarSubtitle', () => {
  it('matches subtitle files named after the video', () => {
    expect(matchSidecarSubtitle('Movie.2024.mkv', 'Movie.2024.srt')).toEqual({ format: 'srt', tag: '' })
    expect(matchSidecarSubtitle('Movie.2024.mkv', 'movie.2024.CHS.ASS')).toEqual({ format: 'ass', tag: 'CHS' })
    expect(matchSidecarSubtitle('Movie.mp4', 'Movie.zh.forced.vtt')).toEqual({ format: 'vtt', tag: 'zh.forced' })
  })

  it('ignores other videos’ subtitles and non-subtitle files', () => {
    expect(matchSidecarSubtitle('Movie.2024.mkv', 'Movie.2024.Extras.srt')).toEqual({ format: 'srt', tag: 'Extras' })
    expect(matchSidecarSubtitle('Movie.mkv', 'Movie2.srt')).toBeNull()
    expect(matchSidecarSubtitle('Movie.mkv', 'Movie.nfo')).toBeNull()
    expect(matchSidecarSubtitle('Movie.mkv', 'Movie.sub')).toBeNull()
  })
})

describe('decodeSubtitleText', () => {
  it('decodes UTF-8 and UTF-16 with byte order marks', () => {
    expect(decodeSubtitleText(new TextEncoder().encode('﻿简体'))).toBe('简体')
    expect(decodeSubtitleText(new Uint8Array([0xff, 0xfe, 0x2d, 0x4e]))).toBe('中')
    expect(decodeSubtitleText(new Uint8Array([0xfe, 0xff, 0x4e, 0x2d]))).toBe('中')
  })

  it('falls back to GB18030 for GBK files', () => {
    // "简体字幕" in GBK.
    expect(decodeSubtitleText(new Uint8Array([0xbc, 0xf2, 0xcc, 0xe5, 0xd7, 0xd6, 0xc4, 0xbb]))).toBe('简体字幕')
  })
})
